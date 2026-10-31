---
last_updated: 2026-10-31
last_updated_by: da
convention: lifeos-freshness-v1
version: 1.0.0
---

# Vault Sync

> **An Obsidian vault can stay the one source for the assets it already holds (projects, people, research areas). `LIFEOS/TOOLS/VaultSync.ts` generates the matching USER files from it, so nothing is maintained twice.** You edit notes in the vault. LifeOS reads `PROJECTS.md`, `CONTACTS.md` and `AREAS.md`, which are rebuilt from those notes whenever they change.

## Configure

`[vault]` in `LIFEOS/USER/CONFIG/LIFEOS_CONFIG.toml` (parsed by `LifeosConfig.ts` into `config.vault`):

```toml
[vault]
path = "~/Notes"                 # vault root
name = "Notes"                   # for obsidian:// links; defaults to the root folder's name

[[vault.sources]]
kind = "projects"                # projects | people | areas
folder = "Projects"              # inside the vault
target = "PROJECTS.md"           # inside LIFEOS/USER
active_status = ["active", "in-progress"]
exclude = ["Archive"]

[[vault.sources]]
kind = "people"
folder = "Areas/People"
target = "CONTACTS.md"

[[vault.sources]]
kind = "areas"
folder = "Areas"
target = "AREAS.md"
exclude = ["People", "Daily"]
```

No `[vault]` means VaultSync does nothing, and the USER files stay hand-maintained as before.

## What it reads

Each entry is one note or one folder directly inside `folder`. A folder's note is the same-named `.md` inside it, else `index.md` or `README.md`. The folder's own index note (`Projects/Projects.md`) is skipped. The fields come from frontmatter: `title`, `aliases`, `status`, `priority`, `summary` (or `description`), `workingDirectory` (or `path`/`repo`), `url`, and `tags`. When there is no summary, the first prose line outside code and dataview blocks is used instead. Wikilinks and Markdown links reduce to their text.

## What it writes

| kind | Output |
|------|--------|
| `projects` | A full table for notes whose `status` is in `active_status`, a compact status-grouped list of everything else (the file is `@`-imported every session, so it stays small), and a Routing Aliases table built from `aliases` and `workingDirectory`. |
| `people` | One row per person: name (linked to the note), aliases, tags, summary. |
| `areas` | One row per area folder, ordered by how many notes it holds. Loose notes are not areas. |

Every target starts with `provenance: vault-sync` frontmatter and a banner saying where to edit. It is rewritten only when its content changes, so the derived-file sync downstream wakes only for real edits.

## Keeping it current

`InstallVaultSync.ts` (registry row `com.lifeos.vaultsync`) watches every source folder and runs VaultSync on change. That is a launchd agent on macOS (top level of each folder), a systemd `.path` unit on Linux, and a recursive watcher task on Windows (see `LIFEOS/DOCUMENTATION/Services/BackgroundServices.md` § Windows).

```bash
bun ~/.claude/LIFEOS/TOOLS/VaultSync.ts --dry-run      # what would change
bun ~/.claude/LIFEOS/TOOLS/VaultSync.ts                # regenerate now
bun ~/.claude/LIFEOS/TOOLS/Services.ts install --only vaultsync --yes
```

## Cross-references

- Config system: `LIFEOS/DOCUMENTATION/Config/ConfigSystem.md`
- Background services: `LIFEOS/DOCUMENTATION/Services/BackgroundServices.md`
- Loader: `LIFEOS/TOOLS/LifeosConfig.ts` (`LifeosVault`)
