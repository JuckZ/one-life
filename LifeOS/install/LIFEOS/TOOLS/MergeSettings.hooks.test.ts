/**
 * A merged settings.json must not run the same hook script twice.
 *
 * Regression for the 2026-11-26 audit: the user overlay carried two UserPromptSubmit
 * groups for the same seven scripts — one written `$HOME/.claude/hooks/X`, one written
 * `C:\Users\...\.claude/hooks/X`. Both were appended, so every prompt ran those hooks
 * twice. Different spellings of the same path are one hook, not two.
 *
 * Run: bun test LifeOS/install/LIFEOS/TOOLS/MergeSettings.hooks.test.ts
 */
import { describe, expect, test } from "bun:test";
import { mergeSettingsPreserving } from "./MergeSettings";

type Group = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };

const scriptOf = (command: string): string => command.match(/hooks[\\/]([A-Za-z0-9_.-]+\.(?:hook\.ts|exe|cmd|ps1))/)?.[1] ?? command;

/** Scripts that appear more than once within the SAME event (a hook may legitimately serve several events). */
function duplicateScripts(merged: any): string[] {
  const out: string[] = [];
  for (const groups of Object.values<any>(merged.hooks ?? {})) {
    const list: Group[] = Array.isArray(groups) ? groups : (groups?.values ?? []);
    const counts = new Map<string, number>();
    for (const g of list) for (const h of g.hooks ?? []) {
      const s = scriptOf(String(h.command));
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    for (const [s, n] of counts) if (n > 1) out.push(s);
  }
  return out;
}

describe("MergeSettings hooks", () => {
  test("the same script registered under two spellings is reported as a duplicate", () => {
    const system = {};
    const user = {
      hooks: {
        UserPromptSubmit: {
          __merge: "append",
          values: [
            { hooks: [{ type: "command", command: "$HOME/.claude/hooks/TimeContext.hook.ts" }] },
            { hooks: [{ type: "command", command: "C:\\Users\\me\\.claude\\hooks\\TimeContext.hook.ts" }] },
          ],
        },
      },
    };
    const merged = mergeSettingsPreserving(system, user, null);
    expect(duplicateScripts(merged)).toEqual(["TimeContext.hook.ts"]);
  });

  test("hooks that only exist once are not flagged, whatever their spelling", () => {
    const system = {};
    const user = {
      hooks: {
        UserPromptSubmit: {
          __merge: "append",
          values: [
            {
              hooks: [
                { type: "command", command: "$HOME/.claude/hooks/TimeContext.hook.ts" },
                { type: "command", command: "C:\\Users\\me\\.claude\\hooks\\SessionTitle.hook.ts" },
              ],
            },
          ],
        },
      },
    };
    const merged = mergeSettingsPreserving(system, user, null);
    expect(duplicateScripts(merged)).toEqual([]);
  });

  test("the deduped overlay in this installation merges with no duplicate script", () => {
    // The real user overlay is USER data and absent on a fresh clone; skip cleanly.
    const path = `${process.env.HOME ?? process.env.USERPROFILE}/.claude/LIFEOS/USER/CONFIG/settings.user.json`;
    const file = require("node:fs").existsSync(path);
    if (!file) {
      console.log("skipped: no user overlay at " + path);
      return;
    }
    const user = JSON.parse(require("node:fs").readFileSync(path, "utf8"));
    const merged = mergeSettingsPreserving({}, user, null);
    expect(duplicateScripts(merged)).toEqual([]);
  });
});

/**
 * `hooks` is a map of events, and the installer writes ~50 entries into it. An overlay
 * that names one event must not erase the rest: that is the 2026-11-26 regression where
 * a single orca UserPromptSubmit entry left every LifeOS hook unwired.
 */
describe("MergeSettings keeps installer hooks per event", () => {
  const installed = {
    SessionStart: [{ hooks: [{ type: "command", command: "$HOME/.claude/hooks/LoadContext.hook.ts" }] }],
    Stop: [{ hooks: [{ type: "command", command: "$HOME/.claude/hooks/StopGates.hook.ts" }] }],
    UserPromptSubmit: [{ hooks: [{ type: "command", command: "$HOME/.claude/hooks/TimeContext.hook.ts" }] }],
  };
  const bridge = [{ hooks: [{ type: "command", command: "C:/Users/me/.bridge/bridge.exe claude" }] }];
  const entries = (hooks: any, event: string): number => {
    const v = hooks?.[event];
    if (!v) return 0;
    return (Array.isArray(v) ? v : (v.values ?? [v])).flatMap((g: any) => g.hooks ?? []).length;
  };

  test("an event the overlay never mentions keeps the installer's groups", () => {
    const merged = mergeSettingsPreserving({}, { hooks: { UserPromptSubmit: { __merge: "append", values: bridge } } }, { hooks: installed });
    expect(entries(merged.hooks, "SessionStart")).toBe(1);
    expect(entries(merged.hooks, "Stop")).toBe(1);
  });

  test("an event the overlay appends to gains the installer's groups, without duplication", () => {
    const merged = mergeSettingsPreserving({}, { hooks: { UserPromptSubmit: { __merge: "append", values: bridge } } }, { hooks: installed });
    expect(entries(merged.hooks, "UserPromptSubmit")).toBe(2);
    expect(duplicateScripts(merged)).toEqual([]);
  });

  test("an event the overlay removes stays removed", () => {
    const merged = mergeSettingsPreserving({}, { hooks: { Stop: { __merge: "remove" } } }, { hooks: installed });
    expect(merged.hooks?.Stop).toBeUndefined();
    expect(entries(merged.hooks, "SessionStart")).toBe(1);
  });

  test("an installer output with no overlay hooks at all is carried forward whole", () => {
    const merged = mergeSettingsPreserving({}, {}, { hooks: installed });
    for (const event of Object.keys(installed)) expect(entries(merged.hooks, event)).toBe(1);
  });
});
