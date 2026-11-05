import { describe, expect, test } from "bun:test";
import { buildBlock } from "./AttentionSurface.hook";
import type { AttentionReading } from "../LIFEOS/TOOLS/Attention";

const reading = (over: Partial<AttentionReading> = {}): AttentionReading => ({
  at: new Date().toISOString(),
  available: true,
  state: { label: "unclear", confidence: "medium", why: "测试" },
  current: { app: "claude", category: "product", streakMin: 3, idleMin: 0 },
  today: { activeMin: 90, firstActive: null, byCategory: { product: 60, other: 30 }, topApps: [], switchesLast30: 2, longestStreakMin: 30 },
  signals: [{ telos: "S1", level: "flag", text: "18:00 之后，今天仍没有对外活动", evidence: "outward=0m" }],
  ...over,
});

describe("AttentionSurface.buildBlock", () => {
  test("surfaces a flag once, then stays quiet inside the cooldown", () => {
    let calls = 0;
    const read = () => (calls++, reading());
    const t0 = 1_000_000_000_000;
    const a = buildBlock(t0, {}, read);
    expect(a.block).toContain("⚑ S1");
    // 2 minutes later: cache expired, read again, but the flag was already surfaced
    const b = buildBlock(t0 + 120_000, a.state, read);
    expect(b.block).toContain("<attention-read>");
    expect(b.block).not.toContain("⚑ S1");
    // 61 minutes later: surfaces again
    const c = buildBlock(t0 + 61 * 60_000, b.state, read);
    expect(c.block).toContain("⚑ S1");
  });

  test("uses the 60s cache instead of re-reading", () => {
    let calls = 0;
    const read = () => (calls++, reading({ signals: [] }));
    const t0 = 1_000_000_000_000;
    const a = buildBlock(t0, {}, read);
    buildBlock(t0 + 30_000, a.state, read);
    expect(calls).toBe(1);
  });

  test("ActivityWatch down → no block at all", () => {
    const down = () => reading({ available: false, signals: [] });
    expect(buildBlock(1, {}, down).block).toBeNull();
  });

  test("notes are context, never surfaced as ⚑", () => {
    const note = () => reading({ signals: [{ telos: "C2", level: "note", text: "n", evidence: "e" }] });
    expect(buildBlock(1, {}, note).block).not.toMatch(/^⚑ [SC]d/m);
  });
});
