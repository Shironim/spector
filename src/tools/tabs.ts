import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';

export function registerTabsTools(server: McpServer): void {
  const listTabsHandler = async () => {
    const manager = BrowserManager.getInstance();
    const tabs = await manager.listTabs();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(tabs, null, 2)
        }
      ]
    };
  };

  const selectTabSchema = {
    index: z
      .number()
      .optional()
      .describe('Index tab target (dari output spector_list_tabs)'),
    url: z
      .string()
      .optional()
      .describe('Substring pencocokan URL target (e.g. "localhost:3000", "admin")'),
    urlPattern: z
      .string()
      .optional()
      .describe('Regex pattern untuk mencocokkan URL target secara presisi (e.g. "^https?:\\/\\/.*\\/checkout")'),
    title: z
      .string()
      .optional()
      .describe('Substring pencocokan judul halaman target'),
    debugSessionId: z
      .string()
      .optional()
      .describe('ID sesi korelasi multi-tool (e.g. dari window.__debugSessionId)')
  };

  const selectTabHandler = async ({ index, url, urlPattern, title, debugSessionId }: any) => {
    const manager = BrowserManager.getInstance();
    const result = await manager.selectTab({ index, url, urlPattern, title, debugSessionId });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'tab_selected',
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

  // Primary Spector tools
  server.tool(
    'spector_list_tabs',
    '[ROUTING: DISCOVER TABS] Melihat daftar seluruh tab yang terbuka pada instance browser Chrome yang terhubung beserta status aktifnya.',
    {},
    listTabsHandler
  );

  server.tool(
    'spector_select_tab',
    '[ROUTING: SWITCH TAB] Berpindah fokus ke tab spesifik berdasarkan index, filter URL, atau judul halaman.',
    selectTabSchema,
    selectTabHandler
  );

  // Backward-compatibility aliases
  server.tool('browser_list_tabs', '[Alias for spector_list_tabs]', {}, listTabsHandler);
  server.tool('browser_select_tab', '[Alias for spector_select_tab]', selectTabSchema, selectTabHandler);
}
