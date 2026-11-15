import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import { jsonResponse } from '../utils/mcp-response.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export interface SessionToolsOptions {
  includeNavigate?: boolean;
}

export function registerSessionTools(
  server: McpServer,
  manager: CdpSessionManager,
  options: SessionToolsOptions = {}
): void {
  const { includeNavigate = true } = options;

  const attachSchema = {
    cdpUrl: z
      .string()
      .optional()
      .default('http://localhost:9222')
      .describe('Chrome remote debugging endpoint on localhost (e.g. "http://localhost:9222" or "ws://127.0.0.1:.../devtools/browser/..." from agent-browser get cdp-url)'),
    autoSelectActiveTab: z
      .boolean()
      .optional()
      .default(true)
      .describe('On first connection select the last tab in context order (not necessarily focused). Reattach preserves the selected target.'),
    autoLaunch: z
      .boolean()
      .optional()
      .default(true)
      .describe('Automatically launch Chrome with remote debugging port enabled if not already running (default: true)')
  };

  server.tool(
    'spector_attach',
    '[LIFECYCLE: CONNECT CHROME] Connects MCP server to Google Chrome via Chrome DevTools Protocol (CDP). Preserves cookies, auth sessions, and local routing.',
    attachSchema,
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
      .describe('"list" lists open tabs; "select" switches active tab (defaults to "select" when index/url/title is provided, otherwise "list")'),
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
      .describe('Select the newest/last tab in browser context order (useful to sync after agent-browser opens a tab)')
  };

  server.tool(
    'spector_tabs',
    '[ROUTING: DISCOVER & SWITCH TABS] Lists all open Chrome tabs or switches active focus between tabs (e.g. between your project tab and a reference website tab) by index, URL filter, page title, or latest: true.',
    tabsSchema,
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

  if (!includeNavigate) return;

  const navigateSchema = {
    url: z
      .string()
      .describe('Target URL (e.g. "http://localhost:3000", "https://app.test") or "reload" to refresh current page'),
    waitUntil: z
      .enum(['load', 'domcontentloaded', 'networkidle'])
      .optional()
      .default('load')
      .describe('Navigation completion condition (default: "load")')
  };

  server.tool(
    'spector_navigate',
    '[NAVIGATION: ROUTE & RELOAD] Navigates the active tab to a URL or reloads the current page.',
    navigateSchema,
    instrumentHandler<{ url: string; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }>(
      'spector_navigate',
      async ({ url, waitUntil }) => {
        const result = await manager.navigate(url, waitUntil ?? 'load');
        return jsonResponse({
          status: 'navigated',
          url: result.url,
          title: result.title
        });
      }, operation => manager.runBrowserOperation(operation, true)
    )
  );
}
