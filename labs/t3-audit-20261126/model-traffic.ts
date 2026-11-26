/**
 * Which model ids actually served traffic in the recent Magpie routing logs, and did they
 * succeed? A lane pinned to an id that never appears, or appears only as failed, is dead
 * config — but an id that is merely absent from the catalog may still be live.
 *
 * Usage: bun model-traffic.ts [routing-dir] [lastN]
 * Default routing dir: $XDG_CONFIG_HOME/magpie/routing, else ~/.config/magpie/routing.
 */
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { homedir } from "node:os";
import { join } from "node:path";

const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
const dir = process.argv[2] ?? join(configHome, "magpie", "routing");
const take = Number(process.argv[3] ?? 6);

const files = readdirSync(dir)
  .filter((f) => /\.jsonl(\.gz)?$/.test(f))
  .sort()
  .slice(-take);

type Row = { ok: number; fail: number };
const byModel = new Map<string, Row>();

for (const f of files) {
  const p = join(dir, f);
  const buf = readFileSync(p);
  const text = f.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = Array.isArray(r.usage) ? r.usage[0] : r.usage;
    const model = String(usage?.model ?? r.model ?? "?");
    const row = byModel.get(model) ?? { ok: 0, fail: 0 };
    if (r.status === "error" || r.status === "failed") row.fail++;
    else row.ok++;
    byModel.set(model, row);
  }
}

console.log("files:", files.join(", "), "\n");
for (const [m, r] of [...byModel.entries()].sort((a, b) => b[1].ok - a[1].ok)) {
  console.log(`${m.padEnd(48)} ok=${String(r.ok).padStart(5)} fail=${String(r.fail).padStart(4)}`);
}
