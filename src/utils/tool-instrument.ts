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

function sanitizeArgs(args: any): any {
  if (!args || typeof args !== 'object') return args;
  const sanitized: Record<string, unknown> = {};
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'credentials'];

  for (const [k, v] of Object.entries(args)) {
    if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
      sanitized[k] = '[REDACTED]';
    } else if (typeof v === 'string' && v.length > 200) {
      sanitized[k] = v.slice(0, 197) + '...';
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}
