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
      .enum(['list', 'select', 'navigate', 'reload'])
      .optional()
      .describe('"list" lists open tabs; "select" switches active tab; "navigate" loads a localhost/same-origin URL (or relative path); "reload" reloads the active tab (defaults to "select" when index/url/title/latest is provided, otherwise "list")'),
    index: z
      .number()
      .optional()
      .describe('Target tab index (from spector_tabs action:"list" output) when action is "select"'),
    url: z
      .string()
      .optional()
      .describe('Target URL substring/glob for action:"select", or absolute/relative URL for action:"navigate" (localhost/local dev or same-origin only)'),
    title: z
      .string()
      .optional()
      .describe('Target page title substring to match when action is "select"'),
    latest: z
      .boolean()
      .optional()
      .describe('Select the newest/last tab in browser context order when action is "select"'),
    waitUntil: z
      .enum(['load', 'domcontentloaded', 'networkidle'])
      .optional()
      .default('load')
      .describe('Lifecycle event to wait for when action is "navigate" or "reload" (default: "load")'),
    openInNewTab: z
      .boolean()
      .optional()
      .default(false)
      .describe('Open the navigated URL in a new tab and switch to it when action is "navigate" (default: false)'),
    timeoutMs: z
      .number()
      .int()
      .min(500)
      .max(60000)
      .optional()
      .describe('Optional navigation/reload timeout in milliseconds (default: 15000)')
  };

  server.registerTool(
    'spector_tabs',
    {
      title: 'List, Switch & Navigate Chrome Tabs',
      description: '[ROUTING: TABS & READ-SAFE NAVIGATION] Lists open Chrome tabs, switches active tab, reloads the active tab, or navigates to local dev / same-origin routes without losing auth sessions.',
      inputSchema: tabsSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    instrumentHandler<{
      action?: 'list' | 'select' | 'navigate' | 'reload';
      index?: number;
      url?: string;
      title?: string;
      latest?: boolean;
      waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
      openInNewTab?: boolean;
      timeoutMs?: number;
    }>(
      'spector_tabs',
      async ({ action, index, url, title, latest, waitUntil, openInNewTab, timeoutMs }) => {
        const effectiveAction =
          action ?? (index !== undefined || url !== undefined || title !== undefined || latest === true ? 'select' : 'list');
        if (effectiveAction === 'list') {
          const tabs = await manager.listTabs();
          return jsonResponse(tabs);
        }

        if (effectiveAction === 'navigate') {
          const result = await manager.navigateTab({
            url: url ?? '',
            waitUntil,
            openInNewTab,
            timeoutMs
          });
          return jsonResponse({
            status: 'navigated',
            activeTab: {
              title: result.title,
              url: result.url,
              viewport: result.viewport
            }
          });
        }

        if (effectiveAction === 'reload') {
          const result = await manager.reloadTab({ waitUntil, timeoutMs });
          return jsonResponse({
            status: 'reloaded',
            activeTab: {
              title: result.title,
              url: result.url,
              viewport: result.viewport
            }
          });
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
