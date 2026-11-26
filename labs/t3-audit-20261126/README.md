# t3code GPT-6.2 audit — verified findings (2026-11-26)

Source: T3 thread `eb79d35f-8d04-47be-8338-685e21207d54` ("优化 Codex 中 GPT-6.2 的使用体验").
Each claim below was re-tested against the current tree; only the ones that still held were acted on.

## Reproduced and fixed
| Claim | Evidence before | Fix |
|---|---|---|
| OpenAI lanes pinned to retired `gpt-6.1-sol` / `gpt-6-astra` | `models.ts` CROSS_VENDOR | moved to `gpt-6.2-sol` / `gpt-6.2-astra`; `models.test.ts` holds it |
| Seven hooks registered twice per prompt | merge output: 20 UPS entries, 7 scripts twice | duplicate `$HOME`/absolute group dropped from the overlay; 13 entries, 0 dups |
| Overlay's `hooks` block replaced the installer's 50 entries across 11 events | live `settings.json` held 1 entry per event | `MergeSettings` now merges `hooks` per event; `mergeHooksByEvent` + 4 tests |
| `model_context_window = 500000` capped a 1M model and let 272K models run past the doubling line | `.codex/config.toml:3` | pin removed; each model uses its catalog window |
| GPT-6.2 rejects `reasoning.effort = none/minimal` | `.codex/config.toml` desktop list | both values removed |

## Checked, did not hold
- **Hooks duplicated in `settings.json`.** The live file has one orca entry per event; `hooks/hooks.json` is the installer payload and has no duplicates. The duplication was in the overlay only.
- **`gpt-6-luna` / `gpt-6-live` retired.** `gpt-6-luna` was live-probed: `[model] vendor=openai requested=low → executed=gpt-6-luna` returned a valid JSON answer. Catalog absence is not proof of retirement.
- **T3 Code on the old `gpt-6-astra`.** T3's own settings carry no gpt pin (`favorites` are Gemini/Claude); the 3 calls seen in the routing log were not a configured default.

## Observed, not acted on (needs the principal's call)
- Cache hit rates: `OpenAI | gpt-6.2-sol` 6.6% and `t3code | gpt-6-astra` 22.8% on 2026-11-24 — needs a Magpie gateway change, not a LifeOS one.
- Default `service_tier = "ultrafast"` and `model_reasoning_effort = "max"`: cost preferences, left as-is.
- `~/.codex/AGENTS.md` (14 lines) and `WRITINGSTYLE.md` (template) are still thin; the report's suggestions are personal content, not defects.

## Reproduce
```bash
bun labs/t3-audit-20261126/model-traffic.ts ~/.config/magpie/routing 6
bun labs/t3-audit-20261126/model-traffic.ts
bun labs/t3-audit-20261126/hook-audit.ts ~/.claude/settings.json
bun test LifeOS/install/LIFEOS/TOOLS/models.test.ts LifeOS/install/LIFEOS/TOOLS/MergeSettings.hooks.test.ts
```
