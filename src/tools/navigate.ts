import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';

export function registerNavigateTool(server: McpServer): void {
  const navigateSchema = {
    url: z
      .string()
      .describe('URL target (e.g. "http://localhost:3000", "https://app.test") atau "reload" untuk merefresh halaman'),
    waitUntil: z
      .enum(['load', 'domcontentloaded', 'networkidle'])
      .optional()
      .describe('Kondisi tunggu navigasi selesai (default: "load")')
  };

  const navigateHandler = async ({ url, waitUntil }: any) => {
    const manager = BrowserManager.getInstance();
    const result = await manager.navigate(url, waitUntil ?? 'load');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'navigated',
              url: result.url,
              title: result.title
            },
            null,
            2
          )
        }
      ]
    };
  };

  server.tool(
    'spector_navigate',
    '[NAVIGATION: ROUTE & RELOAD] Mengarahkan browser ke URL tujuan (mendukung localhost:port, domain .test, .local, https) atau memuat ulang ("reload") halaman setelah hot-reload / perubahan kode.',
    navigateSchema,
    navigateHandler
  );

  server.tool('browser_navigate', '[Alias for spector_navigate]', navigateSchema, navigateHandler);
}
