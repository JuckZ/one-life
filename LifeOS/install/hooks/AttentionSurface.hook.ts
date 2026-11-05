#!/usr/bin/env bun
/**
 * @version 1.0.0
 * AttentionSurface — UserPromptSubmit hook that lets the DA SEE where the principal's
 * attention is going, without being asked.
 *
 * Reads LIFEOS/TOOLS/Attention.ts (live ActivityWatch, AFK-aware, local) and injects one
 * compact `<attention-read>` block per turn: the inferred state, today's distribution, and
 * any flagged signals tied to TELOS ids (S1/C2/C3).
 *
 * Boundaries (each one is deliberate):
 *  - FACTS, NOT A VERDICT. Conduit's contract is "a mirror you pull, never a score". This
 *    block carries evidence; whether it is worth saying anything is the DA's call, in the
 *    DA's voice, once, with the TELOS id attached.
 *  - NO NAGGING. A flagged signal re-surfaces at most once per FLAG_COOLDOWN_MIN; the state
 *    line is quiet context every turn. The cursor is MEMORY/STATE/attention-surface.json.
 *  - NO TITLES. Window titles never reach this block (Attention.ts drops them).
 *  - SILENT ON FAILURE. ActivityWatch down, subagent context, any error → no output, exit 0.
 *    A missing observation must never block or slow a prompt (60s read cache).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isSubagentContext } from "./lib/subagent";
import { getClaudeDir } from "./lib/paths";
import { readAttention, renderLine, type AttentionReading } from "../LIFEOS/TOOLS/Attention";

const STATE_PATH = join(getClaudeDir(), "LIFEOS", "MEMORY", "STATE", "attention-surface.json");
const CACHE_TTL_MS = 60_000;
const FLAG_COOLDOWN_MIN = 60;

interface SurfaceState {
  /** Cached last read, to keep several prompts in one minute from re-querying. */
  cache?: { at: number; reading: AttentionReading };
  /** signal key → epoch ms it was last surfaced */
  surfaced?: Record<string, number>;
}

function loadState(): SurfaceState {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as SurfaceState;
  } catch {
    return {};
  }
}

function saveState(s: SurfaceState): void {
  try {
    if (!existsSync(dirname(STATE_PATH))) mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(s));
  } catch {
    /* state is a convenience; losing it only means a repeated flag */
  }
}

/** The block for this turn, or null when there is nothing to say. Exported for tests. */
export function buildBlock(now = Date.now(), state: SurfaceState = loadState(), read = readAttention): { block: string | null; state: SurfaceState } {
  const cached = state.cache && now - state.cache.at < CACHE_TTL_MS ? state.cache.reading : null;
  const reading = cached ?? read(new Date(now));
  const next: SurfaceState = { ...state, cache: { at: cached ? state.cache!.at : now, reading } };
  if (!reading.available) return { block: null, state: next };

  const surfaced = { ...(state.surfaced ?? {}) };
  const fresh = reading.signals.filter((s) => {
    if (s.level !== "flag") return false;
    const key = `${s.telos}:${s.text.slice(0, 24)}`;
    const last = surfaced[key] ?? 0;
    if (now - last < FLAG_COOLDOWN_MIN * 60_000) return false;
    surfaced[key] = now;
    return true;
  });
  next.surfaced = surfaced;

  const lines = [`<attention-read>`, `👁 ${renderLine(reading)}`];
  for (const s of fresh) lines.push(`⚑ ${s.telos}: ${s.text}（${s.evidence}）`);
  lines.push(
    `(这是观察事实，不是裁决，数据来自本机 ActivityWatch。⚑ 行只在与当前话题相关或确实值得时，用你自己的话对 Juck 提一次：带上 TELOS 编号和证据，先问后说，不说教。` +
      `置信度为 low 时只当背景，不要据此下判断。不要逐字复述本块。)`,
    `</attention-read>`,
  );
  return { block: lines.join("\n") + "\n", state: next };
}

if (import.meta.main) {
  try {
    if (!isSubagentContext()) {
      const { block, state } = buildBlock();
      saveState(state);
      if (block) process.stdout.write(block);
    }
  } catch (e) {
    process.stderr.write(`AttentionSurface error: ${(e as Error)?.message || String(e)}\n`);
  }
  process.exit(0);
}
