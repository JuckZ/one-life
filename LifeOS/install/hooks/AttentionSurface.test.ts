import { describe, expect, test } from "bun:test";
import { oneWatchCli, surface } from "./AttentionSurface.hook";

const ok = (stdout: string) => (_cli: string, args: string[]) => ({ status: 0, stdout: args[0] === "hook" ? stdout : "" });

describe("AttentionSurface shim", () => {
  test("passes one-watch's block through verbatim", () => {
    const block = "<attention-read>\n👁 x\n</attention-read>\n";
    expect(surface({ cli: "/x/cli.ts", subagent: false, exists: () => true, run: ok(block) })).toBe(block);
  });

  test("subagent context → nothing, and one-watch is never run", () => {
    let ran = false;
    const run = () => ((ran = true), { status: 0, stdout: "x" });
    expect(surface({ cli: "/x/cli.ts", subagent: true, exists: () => true, run })).toBe("");
    expect(ran).toBe(false);
  });

  test("one-watch not installed → silent", () => {
    expect(surface({ cli: "/nope/cli.ts", subagent: false, exists: () => false, run: ok("x") })).toBe("");
  });

  test("one-watch fails or times out → silent", () => {
    const run = () => ({ status: null, stdout: "partial" });
    expect(surface({ cli: "/x/cli.ts", subagent: false, exists: () => true, run })).toBe("");
  });

  test("first run writes the lifeos preset before reading", () => {
    const calls: string[][] = [];
    const run = (_c: string, a: string[]) => (calls.push(a), { status: 0, stdout: "" });
    surface({ cli: "/x/cli.ts", subagent: false, exists: (p) => p.endsWith("cli.ts"), run });
    expect(calls[0]).toEqual(["init", "--preset", "lifeos"]);
    expect(calls[1]).toEqual(["hook"]);
    calls.length = 0;
    surface({ cli: "/x/cli.ts", subagent: false, exists: () => true, run });
    expect(calls).toEqual([["hook"]]);
  });

  test("ONE_WATCH_DIR overrides the default location", () => {
    expect(oneWatchCli({ ONE_WATCH_DIR: "/opt/ow" }).replace(/\\/g, "/")).toBe("/opt/ow/src/cli.ts");
  });
});
