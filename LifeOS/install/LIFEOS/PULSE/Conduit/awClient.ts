/**
 * ActivityWatch client — synchronous, local-only, read-only.
 *
 * ActivityWatch (https://activitywatch.net) keeps a continuous, AFK-aware record of the
 * foreground window on Windows/Linux/macOS. Conduit's own appFocus adapter is macOS-only
 * (`osascript`); on Windows this client is the measured-focus source instead.
 *
 * Properties that matter:
 *  - Talks to 127.0.0.1:5600 ONLY. The URL is a constant, not config — a read of local
 *    activity must not be redirectable to another host.
 *  - Spawns `curl` with an argument array (no shell, no interpolation). The query body
 *    goes over stdin.
 *  - Never throws. Unreachable / malformed → null, so callers can say "no data" instead
 *    of "you did nothing".
 *  - Returns window TITLES in raw events because local categorisation needs them. Callers
 *    that persist or print MUST drop titles (Conduit's privacy contract: no titles stored).
 */
import { execFileSync } from "node:child_process";

const AW_QUERY_URL = "http://127.0.0.1:5600/api/0/query/";

/** A span of foreground-window time while the user was not AFK. */
export interface ActiveSpan {
  start: Date;
  end: Date;
  /** Normalised app name — `chrome.exe` → `chrome`. */
  app: string;
  title: string;
}

interface RawEvent {
  timestamp: string;
  duration: number;
  data?: { app?: string; title?: string; status?: string };
}

/** `chrome.exe` → `chrome`. Keeps case so `WindowsTerminal` stays readable. */
export function normalizeApp(app: string): string {
  return app.trim().replace(/\.exe$/i, "");
}

/** Run one ActivityWatch query-language program over [start, end]. null on any failure. */
export function awQuerySync(start: Date, end: Date, program: string, timeoutSec = 4): RawEvent[] | null {
  const payload = JSON.stringify({
    timeperiods: [`${start.toISOString()}/${end.toISOString()}`],
    query: [program],
  });
  try {
    const out = execFileSync(
      "curl",
      ["-s", "--max-time", String(timeoutSec), "-X", "POST", "-H", "Content-Type: application/json", "--data-binary", "@-", AW_QUERY_URL],
      { input: payload, encoding: "utf8", timeout: (timeoutSec + 2) * 1000, windowsHide: true },
    );
    const parsed = JSON.parse(out);
    const first = Array.isArray(parsed) ? parsed[0] : null;
    return Array.isArray(first) ? (first as RawEvent[]) : null;
  } catch {
    return null;
  }
}

const ACTIVE_WINDOW_QUERY =
  'w=query_bucket(find_bucket("aw-watcher-window_"));' +
  'a=query_bucket(find_bucket("aw-watcher-afk_"));' +
  'RETURN=filter_period_intersect(w,filter_keyvals(a,"status",["not-afk"]));';

const AFK_QUERY =
  'a=query_bucket(find_bucket("aw-watcher-afk_"));RETURN=a;';

/** Clip raw events to [start, end] and normalise. Pure. */
export function toSpans(events: RawEvent[], start: Date, end: Date): ActiveSpan[] {
  const out: ActiveSpan[] = [];
  for (const e of events) {
    const s = new Date(e.timestamp);
    const t = new Date(s.getTime() + e.duration * 1000);
    const cs = s < start ? start : s;
    const ct = t > end ? end : t;
    if (Number.isNaN(cs.getTime()) || ct <= cs) continue;
    out.push({ start: cs, end: ct, app: normalizeApp(e.data?.app ?? "?"), title: e.data?.title ?? "" });
  }
  return out.sort((x, y) => x.start.getTime() - y.start.getTime());
}

/** Window time while not AFK within [start, end]. null = ActivityWatch unreachable. */
export function activeSpans(start: Date, end: Date): ActiveSpan[] | null {
  const raw = awQuerySync(start, end, ACTIVE_WINDOW_QUERY);
  return raw ? toSpans(raw, start, end) : null;
}

/**
 * Current AFK state: how long the user has been idle right now (0 = active), or null when
 * unknown. Looks at the latest afk-status event in the last 6 hours.
 */
export function idleSeconds(now: Date = new Date()): number | null {
  const raw = awQuerySync(new Date(now.getTime() - 6 * 3600_000), now, AFK_QUERY);
  if (!raw || raw.length === 0) return null;
  const last = raw.reduce((a, b) => (new Date(a.timestamp) > new Date(b.timestamp) ? a : b));
  if (last.data?.status !== "afk") return 0;
  // An afk event starts when the user went idle and grows by heartbeat, so idle time is
  // "now minus the event's start".
  return Math.max(0, Math.round((now.getTime() - new Date(last.timestamp).getTime()) / 1000));
}
