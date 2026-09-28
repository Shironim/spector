import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { textResponse } from '../types.js';

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
      .describe('Filter tingkat keparahan log (default: "error")'),
    limit: z
      .number()
      .optional()
      .describe('Batas maksimal entri log terbaru yang dikembalikan (default: 50)'),
    format: z
      .enum(['compact', 'verbose'])
      .optional()
      .describe('Format output: "compact" (ringkasan 1 baris/log, hemat token) atau "verbose" (full JSON) (default: "compact")'),
    clearAfterRead: z
      .boolean()
      .optional()
      .describe('Hapus log setelah dibaca (default: true)')
  };

  const consoleHandler = async ({ level, clearAfterRead, limit, format }: any) => {
    const manager = BrowserManager.getInstance();
    const logs = manager.getConsoleLogs(level ?? 'error', clearAfterRead ?? true, limit ?? 50);

    if (logs.length === 0) {
      return textResponse(`No console logs found for level: ${level ?? 'error'}.`);
    }

    const outputText =
      (format ?? 'compact') === 'verbose'
        ? JSON.stringify(logs, null, 2)
        : formatCompactConsoleLogs(logs);

    return textResponse(outputText);
  };

  server.tool(
    'spector_get_console_logs',
    '[TELEMETRY: RUNTIME CONSOLE & CRASHES] Mengambil log konsol browser (console.error, uncaught runtime exception, React/Vue hydration warning, broken assets). Secara default difilter pada tingkat error dan format compact untuk mencegah context rot. Gunakan saat terjadi perilaku aneh atau halaman blank/crash.',
    consoleSchema,
    consoleHandler
  );

  server.tool('browser_get_console_logs', '[Alias for spector_get_console_logs]', consoleSchema, consoleHandler);
}
