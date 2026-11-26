/**
 * Report hook scripts registered more than once inside one event of a settings file.
 *
 * Usage: bun hook-audit.ts <settings.json>
 */
import { homedir } from "node:os";
import { join } from "node:path";

const path = process.argv[2] ?? join(homedir(), ".claude", "settings.json");
const s = JSON.parse(await Bun.file(path).text());
const hooks = s.hooks ?? {};
let dupTotal = 0;

for (const [event, groups] of Object.entries<any>(hooks)) {
  const list = Array.isArray(groups) ? groups : (groups?.values ?? []);
  const names: Record<string, string[]> = {};
  for (const g of list) for (const h of (g.hooks ?? [])) {
    // Key on the script name, but two different `bun …` commands must not collapse into
    // one entry — a truncating prefix made unrelated lifecycle commands look duplicated.
    const cmd = String(h.command);
    const n = cmd.match(/hooks[\\/]([A-Za-z0-9_.-]+)/)?.[1] ?? cmd;
    (names[n] ??= []).push(cmd);
  }
  const dups = Object.entries(names).filter(([, a]) => a.length > 1);
  dupTotal += dups.length;
  console.log(`${event.padEnd(20)} groups=${list.length} scripts=${Object.keys(names).length} dups=${dups.length}`);
  for (const [n, a] of dups) console.log(`   DUP x${a.length} ${n}\n     ${a.join("\n     ")}`);
}

console.log(`\nTotal duplicate scripts: ${dupTotal}`);
