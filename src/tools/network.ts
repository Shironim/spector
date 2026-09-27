import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';

export function registerNetworkTool(server: McpServer): void {
  const networkSchema = {
    filter: z
      .string()
      .optional()
      .describe('Filter string atau regex untuk URL (e.g. "/api/", "users", "graphql")'),
    clearAfterRead: z
      .boolean()
      .optional()
      .describe('Hapus buffer log setelah dibaca agar pemanggilan berikutnya hanya mendapat log baru (default: true)'),
    statusFilter: z
      .enum(['all', 'errors_only', '4xx', '5xx'])
      .optional()
      .describe('Filter berdasarkan status HTTP: "all", "errors_only" (>= 400 atau network failed), "4xx", "5xx" (default: "all")')
  };

  const networkHandler = async ({ filter, clearAfterRead, statusFilter }: any) => {
    const manager = BrowserManager.getInstance();
    const logs = manager.getNetworkLogs(filter, clearAfterRead ?? true, statusFilter);

    if (logs.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No network requests recorded matching the criteria.'
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
    'spector_get_network_logs',
    '[TELEMETRY: API & NETWORK AUDIT] Mengambil log network request/response (XHR, fetch, API payload, HTTP status 4xx/5xx) yang terjadi di browser. Gunakan saat form gagal submit, data tidak tampil, atau ingin memeriksa payload API backend.',
    networkSchema,
    networkHandler
  );

  server.tool('browser_get_network_logs', '[Alias for spector_get_network_logs]', networkSchema, networkHandler);
}
