# one-life — a LifeOS fork

A fork of [danielmiessler/LifeOS](https://github.com/danielmiessler/LifeOS) that adds two things upstream lacks. Upstream lives at the `upstream` remote; pull it with `git fetch upstream && git merge upstream/main`.

## Windows background services

Upstream schedules every background job through launchd (macOS) or systemd (Linux), so on Windows none of them run. This fork adds a third backend, `LifeOS/install/LIFEOS/TOOLS/lib/WinTask.ts`, built on Task Scheduler. With it, Pulse, the work sweep, derived-file sync, Conduit, model sync, the vault sync and the Workflows dispatcher all run on Windows as current-user tasks under `\LifeOS\`. Details: `LifeOS/install/LIFEOS/DOCUMENTATION/Services/BackgroundServices.md` § Windows.

## Obsidian vault as the single source

`[vault]` in `LIFEOS_CONFIG.toml` points LifeOS at an Obsidian vault. `VaultSync.ts` then generates `PROJECTS.md`, `CONTACTS.md` and `AREAS.md` from the vault's notes, and a watcher keeps them current. Details: `LifeOS/install/LIFEOS/DOCUMENTATION/Config/VaultSync.md`.

## Installing this fork over an existing LifeOS

```bash
git clone git@github.com:JuckZ/one-life.git && cd one-life
LIFEOS_SRC="$PWD" LIFEOS_NO_LAUNCH=1 bash LifeOS/install/install.sh
bun ~/.claude/skills/LifeOS/Tools/InstallAll.ts --yes --json --config-root ~/.claude
```

On Windows, run these from Git Bash. `InstallAll` re-overlays the system files. Your USER tree is never touched.
