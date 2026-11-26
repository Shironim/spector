import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import { jsonResponse } from '../utils/mcp-response.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export function registerSessionTools(
  server: McpServer,
  manager: CdpSessionManager
): void {
  const attachSchema = {
    cdpUrl: z
      .string()
      .optional()
      .default('http://localhost:9222')
      .describe('Chrome remote debugging endpoint on localhost (e.g. "http://localhost:9222" or "ws://127.0.0.1:.../devtools/browser/...")'),
    autoSelectActiveTab: z
      .boolean()
      .optional()
      .default(true)
      .describe('On first connection select the last tab in context order. Reattach preserves the selected target.'),
    autoLaunch: z
      .boolean()
      .optional()
      .default(true)
      .describe('Automatically launch Chrome with remote debugging port enabled if not already running (default: true)')
  };

  server.registerTool(
    'spector_attach',
    {
      title: 'Attach to Physical Chrome (CDP)',
      description: '[LIFECYCLE: CONNECT CHROME] Connects Spector to Google Chrome via Chrome DevTools Protocol (CDP), preserving cookies, auth sessions, and local domains.',
      inputSchema: attachSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    instrumentHandler<{ cdpUrl?: string; autoSelectActiveTab?: boolean; autoLaunch?: boolean }>(
      'spector_attach',
      async ({ cdpUrl, autoSelectActiveTab, autoLaunch }) => {
        const result = await manager.attach(cdpUrl, autoSelectActiveTab ?? true, autoLaunch ?? true);
        return jsonResponse({
          status: 'connected',
          activeTab: {
            title: result.title,
            url: result.url,
            viewport: result.viewport
          }
        });
      }
    )
  );

  const tabsSchema = {
    action: z
      .enum(['list', 'select'])
      .optional()
      .describe('"list" lists open tabs; "select" switches active tab (defaults to "select" when index/url/title/latest is provided, otherwise "list")'),
    index: z
      .number()
      .optional()
      .describe('Target tab index (from spector_tabs action:"list" output)'),
    url: z
      .string()
      .optional()
      .describe('Target URL substring or simple wildcard glob to match (e.g. "localhost:3000", "*stripe.com*")'),
    title: z
      .string()
      .optional()
      .describe('Target page title substring to match'),
    latest: z
      .boolean()
      .optional()
      .describe('Select the newest/last tab in browser context order')
  };

  server.registerTool(
    'spector_tabs',
    {
      title: 'List & Switch Chrome Tabs',
      description: '[ROUTING: DISCOVER & SWITCH TABS] Lists all open Chrome tabs or switches active focus between tabs (e.g. between your project tab and a reference website tab).',
      inputSchema: tabsSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    instrumentHandler<{ action?: 'list' | 'select'; index?: number; url?: string; title?: string; latest?: boolean }>(
      'spector_tabs',
      async ({ action, index, url, title, latest }) => {
        const effectiveAction =
          action ?? (index !== undefined || url !== undefined || title !== undefined || latest === true ? 'select' : 'list');
        if (effectiveAction === 'list') {
          const tabs = await manager.listTabs();
          return jsonResponse(tabs);
        }

        const result = await manager.selectTab({ index, url, title, latest });
        return jsonResponse({
          status: 'tab_selected',
          activeTab: {
            title: result.title,
            url: result.url,
            viewport: result.viewport
          },
          ...(result.warning ? { warning: result.warning } : {})
        });
      }
    )
  );
}
