# AGENTS.md — how this fork is maintained

This repository is a **fork** of [danielmiessler/LifeOS](https://github.com/danielmiessler/LifeOS), not a detached copy and not a mirror. Everyone who works in it — human or agent — follows the rules below.

## What this fork is for

The fork exists to run LifeOS on hardware upstream does not support yet (Windows) and to carry a few features this installation needs (Windows services, Obsidian vault as the single source). Read `FORK.md` for what those are.

The fork has two duties at once, and they pull in opposite directions:

- **Stay current.** A fork that stops tracking upstream is a dead branch with extra bugs. Upstream fixes and improvements must flow in.
- **Stay ours.** The features we added must survive every merge, and they must not drift into something only this machine can run.

## The rule

1. **What runs locally is this fork, never upstream.** The installed copy under the LifeOS root is built from this repository. Upstream is a source we merge from, not a system we deploy. When a fix is needed on the running system, it is made here first, then deployed — never patched directly into the installed tree, which the next overlay overwrites.

2. **Track upstream on a schedule, not by accident.** `upstream` is a remote. Fetch and merge `upstream/main` into our `main` regularly, and bring feature branches up to date the same way. Resolve conflicts on our side, in our commits. Prefer merging upstream into `main` first, then merging `main` into the feature branch, so the history shows exactly where upstream ends and our work begins.

3. **Our work lives in reviewable pieces.** Each feature or fix is its own branch with its own commits and, where it fixes a user-visible failure, its own regression test. A change to a system file is made in this repository and in the duplicate copy the installer overlays (`LifeOS/Tools/X.ts` and `LifeOS/install/skills/LifeOS/Tools/X.ts`), or the deployed system silently keeps the old code.

4. **Publish what helps others; keep what does not.** Work that would benefit other installations — a platform fix, a correctness bug, a missing capability — goes upstream as a pull request, in English, small and focused, following the upstream conventions (`SECURITY.md`, the bug-report template, one concern per PR, a clear diagnosis and a negative control). Work that is specific to this installation, or that upstream would not want, stays here and is documented in `FORK.md`.

5. **A closed PR is not a failed PR.** Upstream frequently ports changes by hand and closes the PR with credit. Before assuming a contribution was rejected, read the closing comment: it usually says exactly what was taken, what was tightened and what was left out. Its "not in this port yet" list is the follow-up queue.

6. **Nothing private goes upstream.** The fork is public. The principal's identity, TELOS, contacts, vault paths, machine paths and credentials never enter a commit here. The user tree is a separate private repository.

7. **The deployed copy follows the fork.** After changes land here, the installed tree is refreshed from this repository (see `FORK.md` § Installing this fork over an existing LifeOS) and verified against real behavior — the statusline renders, the health check is green on real checks, the services run. A commit that is not deployed is not done for the machine it was made for.
