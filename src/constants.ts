/**
 * Spector Centralized Engine Constants
 */

export const TIMEOUTS = {
  CDP_CONNECT_MS: 10000,
  CDP_WAIT_MS: 6000,
  INTERACT_DEFAULT_MS: 7000,
  SCREENSHOT_DEFAULT_MS: 4000,
  PICKER_HOTKEY_DEFAULT_MS: 30000,
  NAVIGATION_DEFAULT_MS: 15000,
  SETTLING_DELAY_MS: 300
} as const;

export const TELEMETRY_LIMITS = {
  CONSOLE_LOG_DEFAULT_LIMIT: 50,
  NETWORK_LOG_DEFAULT_LIMIT: 25,
  ARG_STRING_TRUNCATE_LEN: 200,
  DOM_TREE_MAX_DEPTH: 8
} as const;

export const EXTENSION_CANDIDATES = ['.vue', '.tsx', '.jsx', '.svelte', '.blade.php', '.ts', '.js'] as const;

export const SNIPPET_LIMITS = {
  MAX_FILE_SIZE_BYTES: 200_000,
  CONTEXT_LINES_BEFORE: 3,
  CONTEXT_LINES_AFTER: 2
} as const;

export const SELECTOR_LIMITS = {
  MAX_ARIA_LABEL_LEN: 30
} as const;

