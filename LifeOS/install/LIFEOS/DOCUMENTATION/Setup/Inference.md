---
version: 1.0.2
---

# Inference and routing

Status: `bun LIFEOS/ROUTER/Router.ts status` · optional

## What it does

LifeOS runs a lot of small model calls that nobody is watching: scheduled jobs, eval judges, daily reviews, classifiers. This system decides which vendor and which model each one uses. The model for a given effort level (`low`, `medium`, `high`, `max`) comes from one registry, `LIFEOS/TOOLS/models.ts`, so a change of lineup is a one-line edit that every tool follows. `Inference.ts` is the shared tool those jobs call, and the Router (`LIFEOS/ROUTER/`) is the read-only view of who runs what.

Out of the box everything runs on your Claude subscription through the `claude` command, and no file here is required. No API key is needed for the default route. During setup, `bun skills/LifeOS/Tools/DetectInference.ts --apply` looks for the Claude and Codex logins already on the machine and writes `inference-vendor.json` from what it finds: both logins give `anthropic` with an `openai` fallback, one login gives that vendor alone. It replaces only the shipped template or its own earlier write, so a file you edited is left alone (`--force` replaces it). The files below only change the defaults: send unattended work to OpenAI, route image judging to a different vendor, or tune the daily coaching review.

## Fill in

All files live in `LIFEOS/USER/CONFIG/`.

| File | What it controls |
|---|---|
| `inference-vendor.json` | `default`: the vendor unattended calls use (`anthropic`, `openai` or `anthropic-api`). `byLevel`: an optional vendor per effort level (`low`, `medium`, `high`, `max`) that beats `default` for that level, for example `"high": "openai"`. `fallback`: the vendor tried when the chosen vendor fails. Delete `fallback` if you only have one vendor. |
| `vision-judge.json` | Which vendor judges images, per eval suite. `{"version": 1, "suites": {}}` keeps the default (Google). To route one suite to OpenAI, add `"<suite-name>": {"provider": "openai", "level": "medium", "fallback": "google"}`. |
| `coach-review.json` | The daily coaching review that turns your corrections of the assistant into upgrade suggestions. Fields: `lookback_hours`, `rating_threshold` (ratings at or below this count as corrections), `min_confidence`, `max_new_per_day`. The shipped values are the defaults. |

The vendors mean: `anthropic` is the `claude` command on your subscription. `openai` is the `codex` command on your ChatGPT subscription; it never uses an API key. `anthropic-api` is the Anthropic API, paid per token, and covers `low` and `medium` only; it never falls back to the subscription. For one command you can override the file with `--vendor`, and for a whole shell with the `LIFEOS_INFERENCE_VENDOR` environment variable.

## Accounts and secrets

The `anthropic` vendor needs only a logged-in `claude` command. The `openai` vendor needs the `codex` command logged in to a ChatGPT plan (`codex login`, which writes `~/.codex/auth.json`); without that login it fails with "no ChatGPT subscription login". The rest need a key in `~/.claude/.env`:

| Vendor | Key name |
|---|---|
| `anthropic-api` | `ANTHROPIC_API_KEY_LIFEOS` |
| Google vision judge (default) | `GOOGLE_API_KEY` |

For `anthropic`, the helper removes inherited API/proxy credentials and Desktop's `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` flag before launching `claude --safe-mode`. This lets the child use its independent CLI subscription login, including an explicit `CLAUDE_CODE_OAUTH_TOKEN`, while preserving the other auth selectors and selected config profile. A Desktop proxy login alone does not supply that independent login. Check it without sending a model request using `claude --safe-mode auth status` from a standalone CLI environment. This does not change the configured vendor or enable API billing.

Never paste a key into a config file or a chat. Store one with `bun LIFEOS/TOOLS/Secrets.ts set KEY_NAME`: it reads the value from your terminal with echo off (or from a pipe), writes `.env` at mode 0600, and reseals when sealing is set up. If you edit `.env` by hand instead, run `bun LIFEOS/TOOLS/Secrets.ts seal` afterwards. Check that a key is present, without printing it (a key whose value is empty reads `no`):

```bash
bun LIFEOS/TOOLS/Secrets.ts has ANTHROPIC_API_KEY_LIFEOS   # prints "ANTHROPIC_API_KEY_LIFEOS yes" or "no"
```

## Prove it works

```bash
bun LIFEOS/ROUTER/Router.ts status    # exit 0 and "router: N agents, N lanes" when every agent has a lane
bun LIFEOS/ROUTER/Router.ts lanes     # every agent with its vendor, model and effort
bun LIFEOS/ROUTER/Router.ts rules     # the routing rules the dispatcher follows
```

`status` exits 1 and names the agent when one has no lane or points at a model that does not exist. To prove a vendor end to end, make one small live call; this uses your subscription or key:

```bash
bun LIFEOS/TOOLS/Inference.ts --level low --vendor openai "Reply with one word." "Say OK."
```

Swap `openai` for `anthropic` to test the subscription route. A missing key fails with the key's name, and a missing codex login says so. An unknown vendor name fails and lists the accepted ones.
