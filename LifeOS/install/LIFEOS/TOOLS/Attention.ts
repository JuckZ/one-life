#!/usr/bin/env bun
/**
 * @version 1.0.0
 * Attention — the DA's read of where the principal's attention is going RIGHT NOW and
 * whether it is drifting from the ideal state.
 *
 * Conduit (PULSE/Conduit) is the daily mirror: spans in, a deterministic record out, no
 * verdicts. Attention is the layer on top that the DA reads: it takes live, AFK-aware
 * window time from ActivityWatch and produces (1) the inputs for inferring the current
 * state, and (2) named, evidence-carrying SIGNALS tied to TELOS ids (S1, C2, C3).
 *
 * What it will not do, on purpose:
 *  - No single alignment score. Distribution + named signals; the DA (and the principal) judge.
 *  - No window titles in output. Titles are read locally to categorise (so "x.com" can count as
 *    outward-facing) and are dropped before anything is printed or cached. `--titles` opts in
 *    for a human at the terminal; the hook never uses it.
 *  - No invented certainty. Under MIN_ACTIVE_MIN of data it says so and raises no signals.
 *
 * Categories and thresholds are data: USER/CONDUIT/attention.json (self-initialising).
 *
 * CLI:
 *   bun LIFEOS/TOOLS/Attention.ts now [--json]     current state + today's signals
 *   bun LIFEOS/TOOLS/Attention.ts day [YYYY-MM-DD] [--json] [--titles]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { activeSpans, idleSeconds, type ActiveSpan } from "../PULSE/Conduit/awClient.ts";

const CLAUDE_ROOT = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
export const ATTENTION_CONFIG_PATH = join(CLAUDE_ROOT, "LIFEOS", "USER", "CONDUIT", "attention.json");

// ───────────────────────────── config ─────────────────────────────

export interface Category {
  /** Stable name; "product" / "outward" / "distraction" carry meaning for signals. */
  name: string;
  /** Case-insensitive regex tested against `${app} ${title}`. First match wins. */
  match: string;
}

export interface Thresholds {
  /** Minutes of data below which no signals are raised. */
  minActiveMin: number;
  /** Uninterrupted minutes in one category that count as "focused". */
  focusStreakMin: number;
  /** App switches in the last 30 minutes that count as "scattered" (C2). */
  switchesPer30: number;
  /** Local hours [from, to) that count as late night (C3). */
  lateNight: [number, number];
  /** Active minutes inside the late-night window before it is flagged. */
  lateNightMin: number;
  /** One uninterrupted distraction stretch, in minutes, before it is flagged. */
  distractionStreakMin: number;
  /** Idle minutes before the state becomes "away". */
  idleMin: number;
  /** Local hour after which zero outward activity today is flagged (S1). */
  outwardCheckHour: number;
  /** Local hour after which zero product activity today is flagged (S1). */
  productCheckHour: number;
}

export interface AttentionConfig {
  categories: Category[];
  thresholds: Thresholds;
}

export const DEFAULT_ATTENTION_CONFIG: AttentionConfig = {
  categories: [
    { name: "distraction", match: "leagueclient|league of legends|steam|bilibili|哔哩|youtube|抖音|douyin|斗鱼|虎牙" },
    { name: "outward", match: "twitter|\\bx\\.com|/ x\\b|小红书|xiaohongshu|即刻|okjike|掘金|juejin|v2ex|linux\\.do|reddit" },
    { name: "product", match: "claude|^code\\b|cursor|windowsterminal|wezterm|mintty|powershell|pwsh|github|localhost|obsidian" },
  ],
  thresholds: {
    minActiveMin: 20,
    focusStreakMin: 25,
    switchesPer30: 14,
    lateNight: [0, 5],
    lateNightMin: 10,
    distractionStreakMin: 45,
    idleMin: 10,
    outwardCheckHour: 18,
    productCheckHour: 14,
  },
};

export function loadAttentionConfig(path = ATTENTION_CONFIG_PATH): AttentionConfig {
  try {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(DEFAULT_ATTENTION_CONFIG, null, 2));
      return DEFAULT_ATTENTION_CONFIG;
    }
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AttentionConfig>;
    return {
      categories: Array.isArray(raw.categories) ? raw.categories : DEFAULT_ATTENTION_CONFIG.categories,
      thresholds: { ...DEFAULT_ATTENTION_CONFIG.thresholds, ...(raw.thresholds ?? {}) },
    };
  } catch {
    return DEFAULT_ATTENTION_CONFIG;
  }
}

// ───────────────────────────── analysis (pure) ─────────────────────────────

export type StateLabel = "away" | "late-night" | "extended-distraction" | "scattered" | "focused" | "unclear" | "unknown";

export interface Signal {
  /** TELOS id this bears on (S1, C2, C3). */
  telos: string;
  level: "flag" | "note";
  text: string;
  /** What the claim rests on, so the DA never has to take the signal on faith. */
  evidence: string;
}

export interface AttentionReading {
  at: string;
  /** false → ActivityWatch unreachable; nothing else is meaningful. */
  available: boolean;
  state: { label: StateLabel; confidence: "high" | "medium" | "low"; why: string };
  current: { app: string; category: string; streakMin: number; idleMin: number | null } | null;
  today: {
    activeMin: number;
    firstActive: string | null;
    byCategory: Record<string, number>;
    topApps: { app: string; min: number }[];
    switchesLast30: number;
    longestStreakMin: number;
  };
  signals: Signal[];
}

const min = (ms: number) => ms / 60000;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function categorize(app: string, title: string, cats: Category[]): string {
  const hay = `${app} ${title}`.toLowerCase();
  for (const c of cats) {
    try {
      if (new RegExp(c.match, "i").test(hay)) return c.name;
    } catch {
      /* a bad user regex skips that category rather than breaking the read */
    }
  }
  return "other";
}

/** Local fractional hour, 0–24. */
const localHour = (d: Date) => d.getHours() + d.getMinutes() / 60;

interface Run { category: string; start: number; end: number }

/**
 * Collapse spans into category runs. A different category shorter than `glanceMs`, sitting
 * between two spans of the same category, does not break the run (a 40-second look at chat
 * during a work stretch is not a context switch worth flagging).
 */
function runs(spans: { start: Date; end: Date; category: string }[], glanceMs = 90_000, gapMs = 120_000): Run[] {
  const out: Run[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && last.category === s.category && s.start.getTime() - last.end <= gapMs) {
      last.end = Math.max(last.end, s.end.getTime());
    } else {
      out.push({ category: s.category, start: s.start.getTime(), end: s.end.getTime() });
    }
  }
  // absorb short interruptions: A, (short B), A  →  A
  for (let i = 1; i < out.length - 1; i++) {
    const [p, m, n] = [out[i - 1], out[i], out[i + 1]];
    if (p.category === n.category && m.category !== p.category && m.end - m.start < glanceMs && n.start - p.end <= gapMs + glanceMs) {
      p.end = n.end;
      out.splice(i, 2);
      i--;
    }
  }
  return out;
}

export function analyze(
  spans: ActiveSpan[] | null,
  idleSec: number | null,
  now: Date,
  cfg: AttentionConfig = DEFAULT_ATTENTION_CONFIG,
): AttentionReading {
  const t = cfg.thresholds;
  const empty = {
    activeMin: 0, firstActive: null, byCategory: {}, topApps: [], switchesLast30: 0, longestStreakMin: 0,
  };
  if (spans === null) {
    return {
      at: now.toISOString(), available: false,
      state: { label: "unknown", confidence: "low", why: "ActivityWatch 没有响应（本机 127.0.0.1:5600），无法观察" },
      current: null, today: empty, signals: [],
    };
  }

  const cat = spans.map((s) => ({ ...s, category: categorize(s.app, s.title, cfg.categories) }));
  const byCategory: Record<string, number> = {};
  const byApp = new Map<string, number>();
  let activeMs = 0;
  let lateMs = 0;
  for (const s of cat) {
    const ms = s.end.getTime() - s.start.getTime();
    activeMs += ms;
    byCategory[s.category] = (byCategory[s.category] ?? 0) + ms;
    byApp.set(s.app, (byApp.get(s.app) ?? 0) + ms);
    const h = localHour(s.start);
    if (h >= t.lateNight[0] && h < t.lateNight[1]) lateMs += ms;
  }
  const activeMin = min(activeMs);
  const minutes = Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, round1(min(v))]));
  const topApps = [...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([app, ms]) => ({ app, min: round1(min(ms)) }));

  const rs = runs(cat);
  const longestStreakMin = round1(Math.max(0, ...rs.map((r) => min(r.end - r.start))));
  const lastRun = rs[rs.length - 1];
  const lastSpan = cat[cat.length - 1];

  // app switches in the last 30 minutes (app changes, not tab changes)
  const cutoff = now.getTime() - 30 * 60000;
  let switches = 0;
  let prevApp: string | null = null;
  for (const s of cat) {
    if (s.end.getTime() < cutoff) continue;
    if (prevApp !== null && s.app !== prevApp) switches++;
    prevApp = s.app;
  }

  const idleMin = idleSec === null ? null : round1(idleSec / 60);
  const current = lastSpan
    ? {
        app: lastSpan.app,
        category: lastSpan.category,
        // the streak only counts if the run is still live (ended within the last 3 minutes)
        streakMin: lastRun && now.getTime() - lastRun.end <= 180_000 ? round1(min(lastRun.end - lastRun.start)) : 0,
        idleMin,
      }
    : null;

  const enough = activeMin >= t.minActiveMin;
  const hour = localHour(now);
  const lateNow = hour >= t.lateNight[0] && hour < t.lateNight[1];

  // ── state inference: ordered rules, first match wins, every one states why ──
  let state: AttentionReading["state"];
  if (idleMin !== null && idleMin >= t.idleMin) {
    state = { label: "away", confidence: "medium", why: `键鼠已空闲 ${Math.round(idleMin)} 分钟（可能离开、思考或在看视频）` };
  } else if (!current) {
    state = { label: "unclear", confidence: "low", why: "今天还没有活跃窗口记录" };
  } else if (lateNow) {
    state = { label: "late-night", confidence: "high", why: `现在是 ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}，仍在使用 ${current.app}` };
  } else if (current.category === "distraction" && current.streakMin >= t.distractionStreakMin) {
    state = { label: "extended-distraction", confidence: "medium", why: `已连续 ${current.streakMin} 分钟在「分心」类应用（${current.app}）` };
  } else if (switches >= t.switchesPer30) {
    state = { label: "scattered", confidence: "medium", why: `近 30 分钟切换应用 ${switches} 次` };
  } else if (current.category === "product" && current.streakMin >= t.focusStreakMin) {
    state = { label: "focused", confidence: "medium", why: `已连续 ${current.streakMin} 分钟在「产品」类应用（${current.app}）` };
  } else {
    state = { label: "unclear", confidence: "low", why: `当前 ${current.app}（${current.category}），连续 ${current.streakMin} 分钟，没有明确模式` };
  }
  if (!enough && state.label !== "away" && state.label !== "unknown") {
    state = { ...state, confidence: "low", why: `${state.why}；今天数据只有 ${round1(activeMin)} 分钟，判断不可靠` };
  }

  // ── signals: facts tied to TELOS ids; none when data is too thin ──
  const signals: Signal[] = [];
  if (enough) {
    const outward = minutes["outward"] ?? 0;
    const product = minutes["product"] ?? 0;
    if (hour >= t.outwardCheckHour && outward < 1) {
      signals.push({ telos: "S1", level: "flag", text: `${t.outwardCheckHour}:00 之后，今天仍没有对外活动（每日杠杆要求至少碰一次真人）`, evidence: `outward=${outward}m，active=${round1(activeMin)}m` });
    }
    if (hour >= t.productCheckHour && product < 1) {
      signals.push({ telos: "S1", level: "flag", text: `${t.productCheckHour}:00 之后，今天没有产品类活动`, evidence: `product=${product}m，active=${round1(activeMin)}m` });
    }
    const lateMin = round1(min(lateMs));
    if (lateMin >= t.lateNightMin) {
      signals.push({ telos: "C3", level: "flag", text: `今晚 ${t.lateNight[0]}:00–${t.lateNight[1]}:00 之间已活跃 ${lateMin} 分钟`, evidence: `late=${lateMin}m` });
    }
    const distractRun = Math.max(0, ...rs.filter((r) => r.category === "distraction").map((r) => min(r.end - r.start)));
    if (distractRun >= t.distractionStreakMin) {
      signals.push({ telos: "C3", level: "flag", text: `今天有一段连续 ${round1(distractRun)} 分钟停在分心类应用`, evidence: `distractionRun=${round1(distractRun)}m` });
    }
    if (switches >= t.switchesPer30) {
      signals.push({ telos: "C2", level: "flag", text: `近 30 分钟切换应用 ${switches} 次（上下文频繁切换）`, evidence: `switches30=${switches}` });
    }
    if (activeMin >= 120 && longestStreakMin < t.focusStreakMin) {
      signals.push({ telos: "C2", level: "note", text: `今天活跃 ${Math.round(activeMin)} 分钟，但最长连续同类只有 ${longestStreakMin} 分钟`, evidence: `longestStreak=${longestStreakMin}m` });
    }
  }

  return {
    at: now.toISOString(),
    available: true,
    state,
    current,
    today: {
      activeMin: round1(activeMin),
      firstActive: cat[0] ? cat[0].start.toISOString() : null,
      byCategory: minutes,
      topApps,
      switchesLast30: switches,
      longestStreakMin,
    },
    signals,
  };
}

// ───────────────────────────── I/O wrappers ─────────────────────────────

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Live read for "today so far". Never throws. */
export function readAttention(now: Date = new Date(), cfg: AttentionConfig = loadAttentionConfig()): AttentionReading {
  try {
    return analyze(activeSpans(startOfLocalDay(now), now), idleSeconds(now), now, cfg);
  } catch {
    return analyze(null, null, now, cfg);
  }
}

// ───────────────────────────── rendering ─────────────────────────────

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.round(m)}m`);
const CAT_LABEL: Record<string, string> = { product: "产品", outward: "对外", distraction: "分心", other: "其它" };

/** One compact line: the state plus today's distribution. Facts, not a verdict. */
export function renderLine(r: AttentionReading): string {
  if (!r.available) return `状态未知：${r.state.why}`;
  const dist = Object.entries(r.today.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${CAT_LABEL[k] ?? k} ${hm(v)}`)
    .join(" / ");
  const cur = r.current ? `当前 ${r.current.app}（${CAT_LABEL[r.current.category] ?? r.current.category}）连续 ${hm(r.current.streakMin)}` : "当前无活跃窗口";
  return `推测状态 ${r.state.label}（${r.state.confidence}）：${r.state.why} · ${cur} · 今天活跃 ${hm(r.today.activeMin)}${dist ? `（${dist}）` : ""} · 近30分钟切换 ${r.today.switchesLast30} 次`;
}

export function renderText(r: AttentionReading): string {
  const d = new Date(r.at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const L = [`# Attention ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}（本地）`, "", renderLine(r)];
  if (r.signals.length) {
    L.push("", "## 信号（事实 + 证据，不是裁决）");
    for (const s of r.signals) L.push(`- [${s.level === "flag" ? "⚑" : "·"} ${s.telos}] ${s.text}  〔${s.evidence}〕`);
  } else if (r.available) {
    L.push("", "没有触发信号。");
  }
  return L.join("\n");
}

// ───────────────────────────── CLI ─────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? "now";
  const json = args.includes("--json");
  if (cmd === "now") {
    const r = readAttention();
    console.log(json ? JSON.stringify(r, null, 2) : renderText(r));
  } else if (cmd === "day") {
    const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
    const day = dateArg ? new Date(`${dateArg}T00:00:00`) : startOfLocalDay(new Date());
    const end = new Date(Math.min(day.getTime() + 86400000, Date.now()));
    const spans = activeSpans(day, end);
    const r = analyze(spans, null, end);
    console.log(json ? JSON.stringify(r, null, 2) : renderText(r));
    if (args.includes("--titles") && spans) {
      const agg = new Map<string, number>();
      for (const s of spans) agg.set(`${s.app} · ${s.title.slice(0, 60)}`, (agg.get(`${s.app} · ${s.title.slice(0, 60)}`) ?? 0) + min(s.end.getTime() - s.start.getTime()));
      console.log("\n## 窗口标题（仅本地终端显示）");
      for (const [k, v] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`- ${hm(v)}  ${k}`);
    }
  } else {
    console.log("usage: Attention.ts <now|day [YYYY-MM-DD]> [--json] [--titles]");
    process.exit(1);
  }
}
