/**
 * Model lane pins must name models that actually exist.
 *
 * The 2026-11-26 audit of a GPT-6.2 usage report found the OpenAI lanes still pinned to
 * gpt-6.1-sol and gpt-6-astra while the catalog (`.codex/magpie-desktop-models.json`)
 * offered 6.2. A pin to a retired id fails at request time, not at import time, so
 * nothing caught it.
 *
 * Scope: the coding and research lanes only. Voice, transcription and batch models
 * (gpt-live-1, gpt-transcribe) are served by endpoints the desktop catalog does not
 * list, and gpt-6-luna was live-probed on 2026-11-26 and answered — a catalog miss is
 * not proof a lane is dead, so those pins are not held to the catalog here.
 *
 * Run: bun test LifeOS/install/LIFEOS/TOOLS/models.test.ts
 * The catalog is a per-machine file; when it is absent the catalog test skips.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CROSS_VENDOR } from "./models";

const catalogPath = join(homedir(), ".codex", "magpie-desktop-models.json");

/** Lanes whose model is resolved against the Codex/Magpie catalog. */
const CATALOG_LANES = [
  "codexResearcher",
  "codexResearcherFast",
  "rpgSummary",
  "rpgLabel",
  "openaiHigh",
  "openaiMax",
  "openaiJudge",
  "computerUse",
  "astra",
  "sol",
] as const;

function catalogIds(): string[] | null {
  if (!existsSync(catalogPath)) return null;
  const parsed = JSON.parse(readFileSync(catalogPath, "utf8"));
  const list = Array.isArray(parsed) ? parsed : (parsed.models ?? Object.values(parsed));
  return list.map((m: any) => String(m.id ?? m.slug ?? m.name)).filter((id) => id && id !== "undefined");
}

describe("CROSS_VENDOR OpenAI pins", () => {
  test("no lane is left on a retired GPT-6.x id", () => {
    const retired = ["gpt-6.1-sol", "gpt-6-astra"];
    const offenders = Object.entries(CROSS_VENDOR).filter(([, model]) => retired.includes(model));
    expect(offenders).toEqual([]);
  });

  test("every catalog-backed lane names a model the catalog lists", () => {
    const ids = catalogIds();
    if (!ids) {
      console.log(`skipped: no catalog at ${catalogPath}`);
      return;
    }
    const missing = CATALOG_LANES.filter((lane) => !ids.includes(CROSS_VENDOR[lane]));
    expect(missing).toEqual([]);
  });

  test("the agent lanes and the API lanes agree on the current generation", () => {
    expect(CROSS_VENDOR.sol).toBe("gpt-6.2-sol");
    expect(CROSS_VENDOR.astra).toBe("gpt-6.2-astra");
    expect(CROSS_VENDOR.openaiHigh).toBe(CROSS_VENDOR.sol);
    expect(CROSS_VENDOR.openaiMax).toBe(CROSS_VENDOR.sol);
    expect(CROSS_VENDOR.computerUse).toBe(CROSS_VENDOR.astra);
  });
});

