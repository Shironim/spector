import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';

export function registerAttachTool(server: McpServer): void {
  const attachSchema = {
    cdpUrl: z
      .string()
      .optional()
      .describe('Endpoint Chrome remote debugging (default: "http://localhost:9222")'),
    autoSelectActiveTab: z
      .boolean()
      .optional()
      .describe('Otomatis mengikat ke tab aktif terakhir developer (default: true)'),
    autoLaunch: z
      .boolean()
      .optional()
      .describe('Otomatis meluncurkan Chrome dengan debugging port jika belum berjalan (default: true)')
  };

  const attachHandler = async ({ cdpUrl, autoSelectActiveTab, autoLaunch }: any) => {
    const manager = BrowserManager.getInstance();
    const result = await manager.attach(
      cdpUrl,
      autoSelectActiveTab ?? true,
      autoLaunch ?? true
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'connected',
              activeTab: {
                title: result.title,
                url: result.url,
                viewport: result.viewport
              }
            },
            null,
            2
          )
        }
      ]
    };
  };

  server.tool(
    'spector_attach',
    '[LIFECYCLE: CONNECT CHROME] Menghubungkan MCP server ke instance Google Chrome via Chrome DevTools Protocol (CDP port 9222). Otomatis menyalakan Chrome dev profile jika belum aktif.',
    attachSchema,
    attachHandler
  );

  server.tool('browser_attach', '[Alias for spector_attach]', attachSchema, attachHandler);
}
