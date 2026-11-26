/**
 * Export one T3 Code thread's messages to plain text from the T3 state database.
 *
 * Usage: bun read-t3-thread.ts <threadId> [out.txt] [db.sqlite]
 * Default db: ~/.t3/userdata/statev2.sqlite (T3_CODE_HOME overrides the home segment).
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const threadId = process.argv[2];
if (!threadId) {
  console.error("usage: bun read-t3-thread.ts <threadId> [out.txt] [db.sqlite]");
  process.exit(2);
}

const t3Home = process.env.T3_CODE_HOME ?? join(homedir(), ".t3");
const dbPath = process.argv[4] ?? join(t3Home, "userdata", "statev2.sqlite");
const outPath = process.argv[3] ?? join(process.cwd(), `${threadId}.txt`);

const db = new Database(dbPath, { readonly: true });

// A turn's messages hang off its run; the provider thread id is derived from the run id.
const run = db
  .query("select run_id, provider_thread_id from orchestration_v2_projection_runs where thread_id = $t order by ordinal limit 1")
  .get({ $t: threadId }) as any;

if (!run) {
  console.error(`no runs found for thread ${threadId}`);
  process.exit(1);
}

const rows = db
  .query(
    "select role, created_at, payload_json from orchestration_v2_projection_messages where thread_id = $p or run_id = $r order by created_at",
  )
  .all({ $p: run.provider_thread_id, $r: run.run_id }) as any[];

const text = (v: any): string => {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(text).join("\n");
  if (v && typeof v === "object") {
    if (typeof v.text === "string") return v.text;
    if (typeof v.content === "string") return v.content;
    return "";
  }
  return "";
};

const out = [`thread=${threadId} messages=${rows.length}`];
for (const r of rows) out.push(`\n===== ${r.role} @ ${r.created_at} =====\n${text(JSON.parse(r.payload_json))}`);

await Bun.write(outPath, out.join("\n"));
console.log(`wrote ${outPath} (${rows.length} messages)`);
