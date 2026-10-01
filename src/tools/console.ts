import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { textResponse } from '../types.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

function formatCompactConsoleLogs(logs: any[]): string {
  const lines = logs.map(log => {
    const countPart = log.count && log.count > 1 ? `(x${log.count}) ` : '';
    const locPart = log.location ? ` [${log.location}]` : '';
    return `[${log.type.toUpperCase()}] ${countPart}${log.text}${locPart}`;
  });

  return `[${logs.length} console logs recorded (capped at limit)]\n` + lines.join('\n');
}

export function registerConsoleTool(server: McpServer): void {
  const consoleSchema = {
    level: z
      .enum(['all', 'error', 'warn'])
      .optional()
      .describe('Log severity filter (default: "error")'),
    limit: z
      .number()
      .optional()
      .describe('Maximum recent log entries to return (default: 50)'),
    format: z
      .enum(['compact', 'verbose'])
      .optional()
      .describe('Output format: "compact" (token-lean 1 line per log) or "verbose" (full JSON) (default: "compact")'),
    clearAfterRead: z
      .boolean()
      .optional()
      .describe('Clear log buffer after reading (default: true)')
  };

  const consoleHandler = instrumentHandler(
    'spector_get_console_logs',
    async ({ level, clearAfterRead, limit, format }: any) => {
      const manager = BrowserManager.getInstance();
      if (!manager.isAttached()) {
        return textResponse(`[NOTE: Chrome browser is not attached yet. No runtime console listeners are active. Run spector_attach to connect.]\nNo console logs found for level: ${level ?? 'error'}.`);
      }
      const logs = manager.getConsoleLogs(level ?? 'error', clearAfterRead ?? true, limit ?? 50);

      if (logs.length === 0) {
        return textResponse(`No console logs found for level: ${level ?? 'error'}.`);
      }

      const outputText =
        (format ?? 'compact') === 'verbose'
          ? JSON.stringify(logs, null, 2)
          : formatCompactConsoleLogs(logs);

      return textResponse(outputText);
    }
  );

  server.tool(
    'spector_get_console_logs',
    '[TELEMETRY: RUNTIME CONSOLE & CRASHES] Retrieves browser console logs (console.error, uncaught runtime exceptions, Vue/React hydration warnings, broken script assets). Filtered by error severity and compact format by default to prevent context rot. Use when encountering unexpected UI behavior, broken scripts, or blank pages.',
    consoleSchema,
    consoleHandler
  );
}
