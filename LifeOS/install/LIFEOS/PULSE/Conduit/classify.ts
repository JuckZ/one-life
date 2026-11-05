/**
 * Deterministic creation/consumption classifier (v1, no model).
 *
 * This is the honest v1 proxy for challenge C1 (consumption vs creation): a static
 * app→kind map. The v2 local-model layer refines ambiguous cases (e.g. "research on
 * YouTube" vs "cat videos") — but the coarse app-level split is useful on its own and
 * needs zero inference. Edit these lists to taste; they are data, not logic.
 */
import type { BlockKind } from "./types.ts";

const CREATION = [
  "terminal", "iterm", "iterm2", "kitty", "ghostty", "alacritty", "warp",
  "code", "cursor", "vscode", "xcode", "zed", "nvim", "vim", "neovim",
  "logic", "logic pro", "descript", "ableton", "final cut", "davinci",
  "obsidian", "notion", "figma", "sketch", "pixelmator", "photoshop",
  // Windows process names (the ".exe" is stripped before classification)
  "windowsterminal", "powershell", "pwsh", "wezterm", "mintty", "claude", "vroid", "blender",
];

const CONSUMPTION = [
  "safari", "google chrome", "chrome", "arc", "firefox", "brave", "edge",
  "mail", "spark", "superhuman", "outlook",
  "messages", "slack", "discord", "telegram", "whatsapp", "signal",
  "twitter", "x", "youtube", "reddit", "instagram", "tiktok", "news",
  // Windows: chat, video and games (C3: limited-time game binges)
  "weixin", "wechat", "qq", "bilibili", "steam", "leagueclient", "league of legends",
];

/** Keys this short only match exactly: "x" as a substring matches "explorer", "Dropbox", "Weixin"… */
const EXACT_ONLY_MAX_LEN = 2;
const matches = (a: string, k: string) => a === k || (k.length > EXACT_ONLY_MAX_LEN && a.includes(k));

/**
 * Classify a foreground app name into a creation/consumption/neutral bucket.
 * Case-insensitive substring match (exact match for 1–2 character keys); a trailing
 * ".exe" is ignored; unknown apps are neutral (never guessed).
 */
export function classifyApp(app: string): BlockKind {
  const a = app.trim().toLowerCase().replace(/\.exe$/, "");
  if (!a) return "neutral";
  if (CREATION.some((k) => matches(a, k))) return "creation";
  if (CONSUMPTION.some((k) => matches(a, k))) return "consumption";
  return "neutral";
}
