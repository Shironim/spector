import { logger } from './logger.js';
import { failSafeResponse } from './mcp-response.js';
import type { McpToolResponse } from '../types.js';
import { TELEMETRY_LIMITS } from '../constants.js';
import { enforceResponseBudget } from './result-budget.js';

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /auth/i,
  /credentials/i,
  /^value$/i,
  /^(expectedUrl|url)$/i
];

const MAX_SANITIZE_DEPTH = 5;

export function instrumentHandler<TArgs = Record<string, unknown>>(
  toolName: string,
  handler: (args: TArgs) => Promise<McpToolResponse>,
  execute: (operation: () => Promise<McpToolResponse>) => Promise<McpToolResponse> = operation => operation()
): (args: TArgs) => Promise<McpToolResponse> {
  return async (args: TArgs): Promise<McpToolResponse> => {
    const start = Date.now();
    logger.debug('tool_invoked', { tool: toolName, args: sanitizeArgs(args) });

    try {
      const response = enforceResponseBudget(await execute(() => handler(args)));
      const durationMs = Date.now() - start;
      if (response.isError) {
        logger.error('tool_failed', undefined, { tool: toolName, durationMs });
        return response;
      }
      logger.info('tool_succeeded', { tool: toolName, durationMs });
      return response;
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      // Playwright error call logs can include the text supplied to fill/press/select.
      const containsInput = args !== null && typeof args === 'object' && 'value' in args;
      logger.error('tool_failed', containsInput ? undefined : err, { tool: toolName, durationMs, ...(containsInput ? { inputErrorRedacted: true } : {}) });
      return failSafeResponse(toolName, err);
    }
  };
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return value.length > TELEMETRY_LIMITS.ARG_STRING_TRUNCATE_LEN
      ? value.slice(0, TELEMETRY_LIMITS.ARG_STRING_TRUNCATE_LEN - 3) + '...'
      : value;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_SANITIZE_DEPTH) {
    return '[TRUNCATED]';
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, depth + 1));
  }
  const nested: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const isSensitive = k.toLowerCase() !== 'key' && SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(k));
    nested[k] = isSensitive ? '[REDACTED]' : sanitizeValue(v, depth + 1);
  }
  return nested;
}

export function sanitizeArgs(args: unknown): unknown {
  return sanitizeValue(args, 0);
}
