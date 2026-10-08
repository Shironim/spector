import { logger } from './logger.js';
import type { McpToolResponse } from '../types.js';

/**
 * Instruments an MCP tool handler with telemetry logging, timing, and error tracking.
 */
export function instrumentHandler<TArgs = any>(
  toolName: string,
  handler: (args: TArgs) => Promise<McpToolResponse>
): (args: TArgs) => Promise<McpToolResponse> {
  return async (args: TArgs): Promise<McpToolResponse> => {
    const start = Date.now();
    logger.debug('tool_invoked', { tool: toolName, args: sanitizeArgs(args) });

    try {
      const response = await handler(args);
      const durationMs = Date.now() - start;
      logger.info('tool_succeeded', { tool: toolName, durationMs });
      return response;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      logger.error('tool_failed', err, { tool: toolName, durationMs });
      throw err;
    }
  };
}

import { TELEMETRY_LIMITS } from '../constants.js';

function sanitizeArgs(args: any): any {
  if (!args || typeof args !== 'object') return args;
  const sanitized: Record<string, unknown> = {};
  const sensitivePatterns = [
    /password/i,
    /token/i,
    /secret/i,
    /api[_-]?key/i,
    /private[_-]?key/i,
    /auth/i,
    /credentials/i
  ];

  for (const [k, v] of Object.entries(args)) {
    // Properti 'key' tunggal biasanya adalah penekanan tombol keyboard (e.g. 'Enter'), jangan sensor kecuali pola sensitive lain cocok
    const isSensitive = k.toLowerCase() !== 'key' && sensitivePatterns.some(pattern => pattern.test(k));
    if (isSensitive) {
      sanitized[k] = '[REDACTED]';
    } else if (typeof v === 'string' && v.length > TELEMETRY_LIMITS.ARG_STRING_TRUNCATE_LEN) {
      sanitized[k] = v.slice(0, TELEMETRY_LIMITS.ARG_STRING_TRUNCATE_LEN - 3) + '...';
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}
