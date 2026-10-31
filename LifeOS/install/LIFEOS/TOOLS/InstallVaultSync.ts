#!/usr/bin/env bun
/**
 * InstallVaultSync.ts — keep the vault-generated USER files current while the principal edits notes.
 *
 *   bun ~/.claude/LIFEOS/TOOLS/InstallVaultSync.ts             # install
 *   bun ~/.claude/LIFEOS/TOOLS/InstallVaultSync.ts --uninstall # remove
 *   bun ~/.claude/LIFEOS/TOOLS/InstallVaultSync.ts --status    # check
 *
 * Watches every folder named in LIFEOS_CONFIG.toml [vault] and runs VaultSync.ts when one changes.
 * The written USER files then wake the derived-file sync like any hand edit would.
 *
 *   darwin   launchd agent with WatchPaths (top level of each folder; launchd does not recurse)
 *   linux    systemd .path unit, PathModified= per folder (lib/SystemdUser.ts)
 *   windows  Task Scheduler + a recursive fs.watch runner (lib/WinTask.ts, via SystemdUser)
 */

import { realpathSync } from "node:fs";
import * as systemd from "./lib/SystemdUser";
import { agentPath, writeAgent } from "./lib/LaunchAgent";
import { installVerb } from "./lib/InstallVerb";
import { loadLifeosConfig } from "./LifeosConfig";
import { getClaudeDir, lifeosPath } from "./Paths";
import { watchFolders } from "./VaultSync";

declare const Bun: { spawnSync: (cmd: string[], opts?: any) => any; which: (bin: string) => string | null };

const LABEL = "com.lifeos.vaultsync";
const log = (m: string) => console.log(`[InstallVaultSync] ${m}`);

function spec(): systemd.UnitSpec {
  const vault = loadLifeosConfig({ force: true }).vault;
  if (!vault) throw new Error("no [vault] in LIFEOS_CONFIG.toml — configure it first (see VaultSync.ts header)");
  const paths = watchFolders(vault).map((p) => realpathSync(p));
  if (!paths.length) throw new Error(`none of the [vault] source folders exist under ${vault.path}`);
  return {
    label: LABEL,
    description: "LifeOS vault sync",
    exec: [Bun.which("bun") ?? process.execPath, lifeosPath("TOOLS", "VaultSync.ts")],
    logPath: lifeosPath("MEMORY", "OBSERVABILITY", "vault-sync.log"),
    workingDirectory: getClaudeDir(),
    schedule: { kind: "watch", paths, recursive: true },
  };
}

function plist(s: systemd.UnitSpec): string {
  const x = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paths = s.schedule.kind === "watch" ? s.schedule.paths : [];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${s.exec.map((a) => `<string>${x(a)}</string>`).join("")}</array>
  <key>RunAtLoad</key><true/>
  <key>WatchPaths</key><array>${paths.map((p) => `<string>${x(p)}</string>`).join("")}</array>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>WorkingDirectory</key><string>${x(s.workingDirectory ?? getClaudeDir())}</string>
  <key>StandardOutPath</key><string>${x(s.logPath)}</string>
  <key>StandardErrorPath</key><string>${x(s.logPath)}</string>
</dict>
</plist>
`;
}

function launchctl(args: string[]): { ok: boolean; err: string } {
  const p = Bun.spawnSync(["launchctl", ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, err: p.stderr.toString().trim() };
}

async function main(): Promise<void> {
  const arg = installVerb(process.argv, "InstallVaultSync");
  if (systemd.hasUserScheduler()) {
    const s = spec();
    if (arg === "--uninstall") { await systemd.uninstall(s, log); return; }
    if (arg === "--status") { if (!(await systemd.status(s, log))) process.exit(1); return; }
    if (!(await systemd.install(s, log))) process.exit(1);
    return;
  }
  const domain = `gui/${process.getuid?.() ?? ""}`;
  if (arg === "--uninstall") { launchctl(["bootout", domain, agentPath(LABEL)]); log("launchd agent removed"); return; }
  if (arg === "--status") { const r = launchctl(["print", `${domain}/${LABEL}`]); log(r.ok ? "loaded" : "not loaded"); if (!r.ok) process.exit(1); return; }
  launchctl(["bootout", domain, agentPath(LABEL)]);
  const path = writeAgent(LABEL, plist(spec()));
  const r = launchctl(["bootstrap", domain, path]);
  if (!r.ok) { log(`bootstrap failed: ${r.err}`); process.exit(1); }
  log(`launchd agent loaded — ${path}`);
}

main().catch((err) => { console.error(`[InstallVaultSync] Fatal: ${err instanceof Error ? err.message : err}`); process.exit(1); });
