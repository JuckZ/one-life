#!/usr/bin/env bun
/**
 * VaultSync.ts — generate USER files from an Obsidian vault, so the vault stays the one source.
 *
 *   bun ~/.claude/LIFEOS/TOOLS/VaultSync.ts             # regenerate every configured target
 *   bun ~/.claude/LIFEOS/TOOLS/VaultSync.ts --dry-run   # report what would change, write nothing
 *   bun ~/.claude/LIFEOS/TOOLS/VaultSync.ts --json      # one JSON report on stdout
 *
 * A principal who already keeps projects, people and research areas in a vault should not keep
 * them a second time in PROJECTS.md / CONTACTS.md. `[vault]` in LIFEOS_CONFIG.toml names the vault
 * and maps folders to USER files:
 *
 *   [vault]
 *   path = "~/Notes"
 *   [[vault.sources]]
 *   kind = "projects"            # projects | people | areas
 *   folder = "Projects"
 *   target = "PROJECTS.md"
 *   active_status = ["active", "in-progress"]
 *
 * Every entry is one note or one folder directly inside `folder` (a folder's note is the
 * same-named .md inside it, else index.md / README.md). Fields come from the note's frontmatter
 * (title, aliases, status, priority, summary, workingDirectory, tags, url, …) and, when there is no
 * summary, the first prose line. Targets carry a generated banner and are rewritten only when their
 * content changes, so the derived-file watcher downstream is not woken for nothing.
 *
 * No [vault] configured → exit 0 with nothing done: hand-maintained USER files are untouched.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { loadLifeosConfig, type LifeosVault, type LifeosVaultSource } from "./LifeosConfig";

declare const Bun: { YAML?: { parse: (s: string) => unknown } };

export interface VaultEntry {
  name: string;
  /** Vault-relative path of the entry's note ("" when a folder has no note). */
  note: string;
  title: string;
  aliases: string[];
  status: string;
  priority: string;
  summary: string;
  workingDirectory: string;
  url: string;
  tags: string[];
  /** areas only: Markdown notes under the folder, recursively. */
  noteCount: number;
}

export interface TargetReport { kind: string; folder: string; target: string; entries: number; changed: boolean; written: boolean; error?: string }

/* ── frontmatter ────────────────────────────────────────────────────────── */

/** Frontmatter as an object. Bun.YAML when present; otherwise a flat key / list reader that
 *  covers the shapes notes actually use (scalars, quoted scalars, `- item` lists). */
export function frontmatter(text: string): Record<string, unknown> {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  if (Bun.YAML) {
    try {
      const parsed = Bun.YAML.parse(m[1]!);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch { /* malformed YAML in one note must not stop the sync: fall through */ }
  }
  const out: Record<string, unknown> = {};
  let listKey: string | null = null;
  const unq = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, "$2");
  for (const line of m[1]!.split(/\r?\n/)) {
    const item = line.match(/^\s+-\s*(.*)$/);
    if (item && listKey) { (out[listKey] as string[]).push(unq(item[1]!)); continue; }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    if (kv[2] === "") { listKey = kv[1]!; out[listKey] = []; }
    else { listKey = null; out[kv[1]!] = unq(kv[2]!); }
  }
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
/** Wikilinks read as their target's name: "[[Projects/one-auth|Auth]]" → "one-auth". */
const unlink = (s: string): string => s.replace(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/, (_, t: string) => basename(t));
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []).map(str).map(unlink).filter(Boolean);

/** Markdown reduced to its visible text, capped to fit one table cell. */
export function plain(s: string, max = 100): string {
  const t = s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2") // [[target|label]] → label
    .replace(/\[\[([^\]]+)\]\]/g, (_, t: string) => basename(t)) // [[a/b]] → b
    .replace(/[`*_]{1,3}([^`*_]+)[`*_]{1,3}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** First prose line after the frontmatter and the title heading. */
export function firstProse(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  let fenced = false; // inside ``` / ~~~ (dataview, base and code blocks are not prose)
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced || !line || /^(#|>|!\[|\[\[|---|\||<|%%|- \[)/.test(line)) continue;
    return line.replace(/^[-*+]\s+/, "");
  }
  return "";
}

/* ── entries ────────────────────────────────────────────────────────────── */

const SKIP = /^(\.|_)|^attachments$/i;

function folderNote(dir: string): string | null {
  const name = basename(dir);
  for (const cand of [`${name}.md`, "index.md", "README.md"]) {
    const p = join(dir, cand);
    if (existsSync(p)) return p;
  }
  return null;
}

function countNotes(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.test(e.name)) continue;
    if (e.isDirectory()) n += countNotes(join(dir, e.name));
    else if (extname(e.name) === ".md") n++;
  }
  return n;
}

export function readEntries(vault: LifeosVault, source: LifeosVaultSource): VaultEntry[] {
  const root = resolve(vault.path, source.folder);
  if (!existsSync(root)) throw new Error(`vault folder not found: ${root}`);
  const index = `${basename(root)}.md`; // the folder's own index note (Projects/Projects.md) is not an entry
  const entries: VaultEntry[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (SKIP.test(e.name) || e.name === index || source.exclude.includes(e.name) || source.exclude.includes(e.name.replace(/\.md$/, ""))) continue;
    const full = join(root, e.name);
    let notePath: string | null;
    if (e.isDirectory()) notePath = folderNote(full);
    else if (extname(e.name) === ".md") notePath = full;
    else continue;
    // people and projects are notes; an areas entry is a folder (a loose note is not a domain).
    if (source.kind === "areas" && !e.isDirectory()) continue;
    const text = notePath ? readFileSync(notePath, "utf8") : "";
    const fm = frontmatter(text);
    const name = e.isDirectory() ? e.name : e.name.replace(/\.md$/, "");
    entries.push({
      name,
      note: notePath ? relative(vault.path, notePath).split("\\").join("/") : "",
      title: str(fm.title) || name,
      aliases: list(fm.aliases).filter((a) => a !== name && a !== str(fm.title)),
      status: str(fm.status),
      priority: str(fm.priority),
      summary: plain(str(fm.summary) || str(fm.description) || firstProse(text)),
      workingDirectory: str(fm.workingDirectory) || str(fm.path) || str(fm.repo),
      url: str(fm.url) || str(fm.homepage) || str(fm.website),
      tags: list(fm.tags),
      noteCount: e.isDirectory() ? countNotes(full) : 1,
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

/* ── rendering ──────────────────────────────────────────────────────────── */

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim() || "—";
const link = (vault: LifeosVault, e: VaultEntry): string =>
  e.note ? `[${cell(e.name)}](obsidian://open?vault=${encodeURIComponent(vault.name)}&file=${encodeURIComponent(e.note.replace(/\.md$/, ""))})` : cell(e.name);

function banner(vault: LifeosVault, source: LifeosVaultSource, title: string): string[] {
  return [
    "---",
    "provenance: vault-sync",
    `source: ${JSON.stringify(join(vault.path, source.folder).split("\\").join("/"))}`,
    "last_updated_by: VaultSync",
    "convention: pai-freshness-v1",
    "---",
    "",
    `# ${title}`,
    "",
    `> Generated by \`LIFEOS/TOOLS/VaultSync.ts\` from the vault folder \`${source.folder}\`. Edit the notes in the vault, not this file — the next sync rewrites it.`,
    "",
  ];
}

export function renderProjects(vault: LifeosVault, source: LifeosVaultSource, entries: VaultEntry[]): string {
  const active = new Set(source.activeStatus.map((s) => s.toLowerCase()));
  const isActive = (e: VaultEntry) => active.has(e.status.toLowerCase());
  const main = entries.filter(isActive);
  const rest = entries.filter((e) => !isActive(e));
  const lines = banner(vault, source, "Projects");
  lines.push(`## Active (${main.length})`, "");
  if (main.length) {
    lines.push("| Project | Status | Priority | Path | URL | Summary |", "|---|---|---|---|---|---|");
    for (const e of main) {
      lines.push(`| ${link(vault, e)} | ${cell(e.status)} | ${cell(e.priority)} | ${e.workingDirectory ? `\`${cell(e.workingDirectory)}\`` : "—"} | ${cell(e.url)} | ${cell(e.summary)} |`);
    }
  } else {
    lines.push(`_No note in \`${source.folder}\` has status ${source.activeStatus.map((s) => `\`${s}\``).join(" / ") || "(none configured)"}. Set \`status\` in a project's frontmatter to list it here._`);
  }
  // Everything else stays visible, compactly, grouped by status — an always-loaded file must stay small.
  const groups = new Map<string, VaultEntry[]>();
  for (const e of rest) groups.set(e.status || "no status", [...(groups.get(e.status || "no status") ?? []), e]);
  lines.push("", `## Other projects (${rest.length})`, "");
  for (const [status, es] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- **${status}** (${es.length}): ${es.map((e) => e.name).join(", ")}`);
  }
  const aliased = entries.filter((e) => e.aliases.length || e.workingDirectory);
  if (aliased.length) {
    lines.push("", "## Routing Aliases", "", "When you say... | The DA routes to...", "---|---");
    for (const e of aliased) {
      const say = [e.name, ...e.aliases].map((a) => `"${cell(a)}"`).join(", ");
      lines.push(`${say} | ${e.workingDirectory ? `\`${cell(e.workingDirectory)}\`` : `vault note \`${e.note}\``}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function renderPeople(vault: LifeosVault, source: LifeosVaultSource, entries: VaultEntry[]): string {
  const lines = banner(vault, source, "Contacts");
  lines.push(`${entries.length} people. Open a name for the full note.`, "", "| Name | Also known as | Tags | Notes |", "|---|---|---|---|");
  for (const e of entries) lines.push(`| ${link(vault, e)} | ${cell(e.aliases.join(", "))} | ${cell(e.tags.join(", "))} | ${cell(e.summary)} |`);
  return lines.join("\n") + "\n";
}

export function renderAreas(vault: LifeosVault, source: LifeosVaultSource, entries: VaultEntry[]): string {
  const lines = banner(vault, source, "Areas & Research Domains");
  lines.push("What the principal studies and maintains, one row per area folder in the vault.", "", "| Area | Notes | Tags | Summary |", "|---|---|---|---|");
  for (const e of [...entries].sort((a, b) => b.noteCount - a.noteCount)) {
    lines.push(`| ${link(vault, e)} | ${e.noteCount} | ${cell(e.tags.join(", "))} | ${cell(e.summary)} |`);
  }
  return lines.join("\n") + "\n";
}

const RENDER = { projects: renderProjects, people: renderPeople, areas: renderAreas } as const;

/* ── sync ───────────────────────────────────────────────────────────────── */

export function syncVault(vault: LifeosVault, userDir: string, opts: { dryRun: boolean }): TargetReport[] {
  return vault.sources.map((source) => {
    const target = resolve(userDir, source.target);
    const base = { kind: source.kind, folder: source.folder, target: source.target };
    try {
      if (!target.startsWith(resolve(userDir))) throw new Error(`target escapes the USER tree: ${source.target}`);
      const entries = readEntries(vault, source);
      const next = RENDER[source.kind](vault, source, entries);
      const prev = existsSync(target) ? readFileSync(target, "utf8") : null;
      const changed = prev !== next;
      if (changed && !opts.dryRun) {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, next);
      }
      return { ...base, entries: entries.length, changed, written: changed && !opts.dryRun };
    } catch (e) {
      return { ...base, entries: 0, changed: false, written: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** The folders a watcher should follow for this vault config. */
export function watchFolders(vault: LifeosVault): string[] {
  return [...new Set(vault.sources.map((s) => resolve(vault.path, s.folder)))].filter((p) => existsSync(p) && statSync(p).isDirectory());
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const json = process.argv.includes("--json");
  const config = loadLifeosConfig({ force: true });
  if (!config.vault) {
    if (json) console.log(JSON.stringify({ ok: true, configured: false, targets: [] }));
    else console.log("[VaultSync] no [vault] in LIFEOS_CONFIG.toml — nothing to do");
    process.exit(0);
  }
  if (!existsSync(config.vault.path)) {
    console.error(`[VaultSync] vault not found: ${config.vault.path}`);
    process.exit(1);
  }
  const targets = syncVault(config.vault, config.paths.userDir, { dryRun });
  const ok = targets.every((t) => !t.error);
  if (json) console.log(JSON.stringify({ ok, configured: true, dryRun, vault: config.vault.path, targets }, null, 2));
  else {
    for (const t of targets) {
      const state = t.error ? `✗ ${t.error}` : t.changed ? (t.written ? "✎ updated" : "would update") : "= unchanged";
      console.log(`[VaultSync] ${t.folder} → ${t.target}: ${t.entries} entries, ${state}`);
    }
  }
  process.exit(ok ? 0 : 1);
}
