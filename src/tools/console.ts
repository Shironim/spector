import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';

export function registerConsoleTool(server: McpServer): void {
  const consoleSchema = {
    level: z
      .enum(['all', 'error', 'warn'])
      .optional()
      .describe('Filter tingkat keparahan log (default: "error")'),
    clearAfterRead: z
      .boolean()
      .optional()
      .describe('Hapus log setelah dibaca (default: true)')
  };

  const consoleHandler = async ({ level, clearAfterRead }: any) => {
    const manager = BrowserManager.getInstance();
    const logs = manager.getConsoleLogs(level ?? 'error', clearAfterRead ?? true);

    if (logs.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No console logs found for level: ${level ?? 'error'}.`
          }
        ]
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(logs, null, 2)
        }
      ]
    };
  };

  server.tool(
    'spector_get_console_logs',
    '[TELEMETRY: RUNTIME CONSOLE & CRASHES] Mengambil log konsol browser (console.error, uncaught runtime exception, React/Vue hydration warning, broken assets). Gunakan saat terjadi perilaku aneh atau halaman blank/crash.',
    consoleSchema,
    consoleHandler
  );

  server.tool('browser_get_console_logs', '[Alias for spector_get_console_logs]', consoleSchema, consoleHandler);
}
