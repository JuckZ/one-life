import { describe, expect, test } from "bun:test";
import { classifyApp } from "../PULSE/Conduit/classify.ts";
import { normalizeApp, toSpans, type ActiveSpan } from "../PULSE/Conduit/awClient.ts";
import { analyze, categorize, DEFAULT_ATTENTION_CONFIG as CFG } from "./Attention.ts";

/** Build a span `fromMin` minutes after `base` lasting `lenMin`. */
const base = new Date(2026, 10, 6, 9, 0, 0); // 09:00 local
const span = (app: string, fromMin: number, lenMin: number, title = ""): ActiveSpan => ({
  start: new Date(base.getTime() + fromMin * 60000),
  end: new Date(base.getTime() + (fromMin + lenMin) * 60000),
  app,
  title,
});
const at = (h: number, m = 0) => new Date(2026, 10, 6, h, m, 0);

describe("classifyApp (Windows names)", () => {
  test("strips .exe and no longer treats every .exe as the 'x' app", () => {
    expect(classifyApp("explorer.exe")).toBe("neutral"); // was consumption via substring "x"
    expect(classifyApp("VRoidStudio.exe")).toBe("creation");
    expect(classifyApp("Code.exe")).toBe("creation");
    expect(classifyApp("WindowsTerminal.exe")).toBe("creation");
    expect(classifyApp("claude.exe")).toBe("creation");
    expect(classifyApp("chrome.exe")).toBe("consumption");
    expect(classifyApp("Weixin.exe")).toBe("consumption");
    expect(classifyApp("ChatGPT.exe")).toBe("neutral");
  });
  test("bare 'x' (the app) still matches exactly", () => {
    expect(classifyApp("X")).toBe("consumption");
  });
});

describe("awClient pure helpers", () => {
  test("normalizeApp", () => {
    expect(normalizeApp("chrome.exe")).toBe("chrome");
    expect(normalizeApp("WindowsTerminal.EXE")).toBe("WindowsTerminal");
  });
  test("toSpans clips to the window and drops spans outside it", () => {
    const start = new Date("2026-11-06T00:00:00Z");
    const end = new Date("2026-11-06T00:02:00Z");
    const spans = toSpans(
      [
        { timestamp: "2026-11-05T23:59:30Z", duration: 60, data: { app: "chrome.exe", title: "a" } }, // 30s inside
        { timestamp: "2026-11-06T00:01:50Z", duration: 60, data: { app: "Code.exe", title: "b" } }, // 10s inside
        { timestamp: "2026-11-06T00:05:00Z", duration: 60, data: { app: "x.exe" } }, // outside
      ],
      start,
      end,
    );
    expect(spans.map((s) => [s.app, (s.end.getTime() - s.start.getTime()) / 1000])).toEqual([["chrome", 30], ["Code", 10]]);
  });
});

describe("categorize", () => {
  test("title can make a browser outward-facing, app alone cannot", () => {
    expect(categorize("chrome", "Home / X", CFG.categories)).toBe("outward");
    expect(categorize("chrome", "微信表情", CFG.categories)).toBe("other");
    expect(categorize("claude", "Claude", CFG.categories)).toBe("product");
    expect(categorize("LeagueClientUx", "", CFG.categories)).toBe("distraction");
  });
  test("a broken user regex is skipped, not fatal", () => {
    expect(categorize("a", "b", [{ name: "bad", match: "(" }, { name: "ok", match: "a" }])).toBe("ok");
  });
});

describe("analyze", () => {
  test("ActivityWatch down → unknown, no signals, no invented state", () => {
    const r = analyze(null, null, at(10));
    expect(r.available).toBe(false);
    expect(r.state.label).toBe("unknown");
    expect(r.signals).toEqual([]);
  });

  test("thin data raises no signals and low confidence", () => {
    const r = analyze([span("claude", 0, 5)], 0, at(20));
    expect(r.signals).toEqual([]);
    expect(r.state.confidence).toBe("low");
  });

  test("a long product stretch reads as focused", () => {
    const r = analyze([span("claude", 0, 40)], 0, at(9, 41));
    expect(r.state.label).toBe("focused");
    expect(r.current?.streakMin).toBeGreaterThanOrEqual(40);
  });

  test("a 40-second glance at chat inside a work stretch does not break the streak", () => {
    const r = analyze([span("claude", 0, 20), span("Weixin", 20, 0.6), span("claude", 20.6, 20)], 0, at(9, 41));
    expect(r.current?.streakMin).toBeGreaterThanOrEqual(40);
    expect(r.state.label).toBe("focused");
  });

  test("idle beyond the threshold → away, regardless of the last window", () => {
    const r = analyze([span("claude", 0, 30)], 20 * 60, at(9, 51));
    expect(r.state.label).toBe("away");
  });

  test("late night activity flags C3 and labels late-night", () => {
    const night = new Date(2026, 10, 6, 1, 30, 0);
    const spans: ActiveSpan[] = [{ start: new Date(2026, 10, 6, 1, 0, 0), end: night, app: "chrome", title: "" }];
    const r = analyze(spans, 0, new Date(2026, 10, 6, 1, 31, 0));
    expect(r.state.label).toBe("late-night");
    expect(r.signals.some((s) => s.telos === "C3")).toBe(true);
  });

  test("S1: after 18:00 with zero outward minutes is flagged, with evidence", () => {
    const r = analyze([span("claude", 0, 120)], 0, at(19));
    const s1 = r.signals.find((s) => s.telos === "S1" && s.text.includes("对外"));
    expect(s1?.level).toBe("flag");
    expect(s1?.evidence).toContain("outward=0m");
  });

  test("S1 is not flagged when outward activity exists", () => {
    const r = analyze([span("claude", 0, 100), span("chrome", 100, 10, "Home / X")], 0, at(19));
    expect(r.signals.find((s) => s.telos === "S1" && s.text.includes("对外"))).toBeUndefined();
  });

  test("C2: many app switches in 30 minutes → scattered + flag", () => {
    const spans: ActiveSpan[] = [span("claude", 0, 60)];
    const apps = ["chrome", "Weixin", "Code", "explorer"];
    for (let i = 0; i < 16; i++) spans.push(span(apps[i % 4], 60 + i * 1.5, 1.4));
    const r = analyze(spans, 0, at(10, 25));
    expect(r.today.switchesLast30).toBeGreaterThanOrEqual(14);
    expect(r.state.label).toBe("scattered");
    expect(r.signals.some((s) => s.telos === "C2" && s.level === "flag")).toBe(true);
  });

  test("never emits titles", () => {
    const r = analyze([span("chrome", 0, 30, "SECRET-TITLE QQ邮箱")], 0, at(9, 31));
    expect(JSON.stringify(r)).not.toContain("SECRET-TITLE");
  });
});
