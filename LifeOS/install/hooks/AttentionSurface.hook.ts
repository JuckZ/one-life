#!/usr/bin/env bun
/**
 * @version 2.0.0
 * AttentionSurface — UserPromptSubmit hook: lets the DA see where the principal's attention
 * is going. v2 is a SHIM. The reader, the state inference, the signal rules and the flag
 * cooldown live in the standalone `one-watch` project (JuckZ/one-watch, local-only, zero
 * dependencies, no LifeOS dependency). LifeOS only supplies two things: the preset that
 * tags signals with TELOS ids in Chinese (`one-watch init --preset lifeos`), and this
 * subagent guard.
 *
 * Where one-watch is found: $ONE_WATCH_DIR, else ~/Projects/one-watch. Not found, not
 * runnable, slow, ActivityWatch down, subagent context → no output, exit 0. A missing
 * observation must never block or slow a prompt.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isSubagentContext } from "./lib/subagent";

const TIMEOUT_MS = 4000;

export const oneWatchCli = (env: Record<string, string | undefined> = process.env): string =>
  join(env.ONE_WATCH_DIR || join(homedir(), "Projects", "one-watch"), "src", "cli.ts");

const oneWatchConfig = (env: Record<string, string | undefined> = process.env): string =>
  join(env.ONE_WATCH_HOME || join(homedir(), ".one-watch"), "config.json");

type Runner = (cli: string, args: string[]) => { status: number | null; stdout: string };

const realRunner: Runner = (cli, args) => {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return { status: r.status, stdout: r.stdout ?? "" };
};

/** The block to inject this turn, or "" when there is nothing to say. Exported for tests. */
export function surface(
  opts: { cli?: string; subagent?: boolean; run?: Runner; exists?: (p: string) => boolean } = {},
): string {
  const cli = opts.cli ?? oneWatchCli();
  const exists = opts.exists ?? existsSync;
  if (opts.subagent ?? isSubagentContext()) return "";
  if (!exists(cli)) return "";
  const run = opts.run ?? realRunner;
  // First run only: write the LifeOS preset (TELOS tags, Chinese). Never overwrites a config.
  if (!exists(oneWatchConfig())) run(cli, ["init", "--preset", "lifeos"]);
  const r = run(cli, ["hook"]);
  return r.status === 0 ? r.stdout : "";
}

if (import.meta.main) {
  try {
    const out = surface();
    if (out) process.stdout.write(out);
  } catch (e) {
    process.stderr.write(`AttentionSurface error: ${(e as Error)?.message || String(e)}\n`);
  }
  process.exit(0);
}
