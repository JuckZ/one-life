/**
 * Subscription auth handoff. Unit tests use synthetic credentials only.
 * Run: bun test LifeOS/install/LIFEOS/TOOLS/Inference.test.ts
 * Opt-in local regression (requires a saved CLI login; sends NO model requests):
 *   LIFEOS_TEST_CLAUDE_AUTH=1 bun test LifeOS/install/LIFEOS/TOOLS/Inference.test.ts
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { claudeSubscriptionEnv, resolveClaudeBin } from './Inference';

const desktopAuth = {
  CLAUDECODE: '1',
  CLAUDE_CODE_ENTRYPOINT: 'claude-desktop-3p',
  CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
  CLAUDE_CODE_HOST_AUTH_ENV_VAR: 'ANTHROPIC_AUTH_TOKEN',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  ANTHROPIC_API_KEY: 'dummy-api-key',
  ANTHROPIC_AUTH_TOKEN: 'dummy-proxy-token',
  ANTHROPIC_BASE_URL: 'http://localhost:3425',
};

describe('claudeSubscriptionEnv', () => {
  test('Desktop releases host auth ownership along with its proxy credentials', () => {
    const parent = Object.freeze({ ...desktopAuth, PATH: '/example/bin', CLAUDE_CONFIG_DIR: '/example/profile' });
    const env = claudeSubscriptionEnv(parent);
    expect(env).toEqual({
      PATH: parent.PATH,
      CLAUDE_CONFIG_DIR: parent.CLAUDE_CONFIG_DIR,
      CLAUDE_CODE_ENTRYPOINT: parent.CLAUDE_CODE_ENTRYPOINT,
      CLAUDE_CODE_HOST_AUTH_ENV_VAR: parent.CLAUDE_CODE_HOST_AUTH_ENV_VAR,
      CLAUDE_CODE_OAUTH_TOKEN: '',
    });
    expect(parent).toEqual({ ...desktopAuth, PATH: '/example/bin', CLAUDE_CONFIG_DIR: '/example/profile' });
  });

  test('standalone CLI keeps its explicit OAuth and selected profile', () => {
    const parent = Object.freeze({
      PATH: '/example/bin', HOME: '/example', USER: 'example',
      CLAUDE_CONFIG_DIR: '/example/profile', CLAUDE_CODE_OAUTH_TOKEN: 'dummy-oauth-token',
      LIFEOS_INFERENCE_VENDOR: 'anthropic', LIFEOS_NOTIFICATION_CHANNEL: 'imessage',
    });
    expect(claudeSubscriptionEnv(parent)).toEqual(parent);
    expect(claudeSubscriptionEnv(parent)).not.toBe(parent);
  });

  test('API credentials cannot override standalone CLI OAuth', () => {
    const env = claudeSubscriptionEnv({
      ANTHROPIC_API_KEY: 'dummy-api-key', ANTHROPIC_AUTH_TOKEN: 'dummy-proxy-token',
      ANTHROPIC_BASE_URL: 'http://localhost:3425', CLAUDE_CODE_OAUTH_TOKEN: 'dummy-oauth-token',
    });
    expect(env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'dummy-oauth-token' });
  });
});

// Read only the two non-sensitive status fields; never print stdout/stderr, which may contain account data.
function authStatus(env: NodeJS.ProcessEnv): { exit: number | null; loggedIn: boolean; authMethod: string } {
  const proc = spawnSync(resolveClaudeBin(), ['--safe-mode', 'auth', 'status'], {
    env, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  if (proc.error || proc.signal) throw new Error('claude auth status did not complete');
  let status: { loggedIn?: unknown; authMethod?: unknown };
  try { status = JSON.parse(proc.stdout); }
  catch { throw new Error('claude auth status did not return JSON'); }
  if (typeof status.loggedIn !== 'boolean' || typeof status.authMethod !== 'string') {
    throw new Error('claude auth status omitted login fields');
  }
  return { exit: proc.status, loggedIn: status.loggedIn, authMethod: status.authMethod };
}

describe.skipIf(process.env.LIFEOS_TEST_CLAUDE_AUTH !== '1')('local CLI auth fallback (no inference)', () => {
  test('standalone CLI still recognizes its subscription authentication', () => {
    const env = claudeSubscriptionEnv({ ...process.env, CLAUDE_CODE_OAUTH_TOKEN: '' });
    const status = authStatus(env);
    expect(status.exit).toBe(0);
    expect(status.loggedIn).toBe(true);
    expect(['claude.ai', 'oauth_token']).toContain(status.authMethod);
  }, 40_000);

  test('Desktop credential scrub falls back to the same saved login only after releasing host ownership', () => {
    const desktop = { ...process.env, ...desktopAuth };
    // Historical control: proxy credentials cleared, host still owns auth. The real CLI must reject it.
    const legacy = { ...desktop };
    delete legacy.CLAUDECODE;
    delete legacy.ANTHROPIC_API_KEY;
    delete legacy.ANTHROPIC_AUTH_TOKEN;
    delete legacy.ANTHROPIC_BASE_URL;
    expect(authStatus(legacy)).toEqual({ exit: 1, loggedIn: false, authMethod: 'none' });
    expect(authStatus(claudeSubscriptionEnv(desktop))).toEqual({ exit: 0, loggedIn: true, authMethod: 'claude.ai' });
  }, 70_000);
});
