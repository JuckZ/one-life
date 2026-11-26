/**
 * Compare the hook map Claude Code actually loads against the one a merge would produce.
 *
 * Usage: bun check-hooks-live.ts [settings.json] [merge-output.json]
 * Defaults resolve under the config root (CLAUDE_CONFIG_DIR, else ~/.claude).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const livePath = process.argv[2] ?? join(root, "settings.json");
const probePath = process.argv[3] ?? join(homedir(), "AppData", "Local", "Temp", "merge-probe.json");

const read = async (p: string) => (existsSync(p) ? JSON.parse(await Bun.file(p).text()) : null);

const audit = (label: string, s: any) => {
  console.log(`\n### ${label}`);
  for (const [event, groups] of Object.entries<any>(s?.hooks ?? {})) {
    const list = Array.isArray(groups) ? groups : (groups?.values ?? []);
    const names = list.flatMap((g: any) =>
      (g.hooks ?? []).map((h: any) => String(h.command).match(/hooks[\\/]([A-Za-z0-9_.-]+)/)?.[1] ?? String(h.command)),
    );
    console.log(`${event.padEnd(20)} ${names.length === 0 ? "(none)" : names.join(", ")}`);
  }
};

const live = await read(livePath);
const probe = await read(probePath);
if (live) audit(`LIVE ${livePath}`, live);
if (probe) audit(`MERGE ${probePath}`, probe);
if (!probe) console.log(`\n(no merge output at ${probePath}; run MergeSettings --output there first)`);
