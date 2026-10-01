import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { textResponse } from '../types.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

function formatCompactNetworkLogs(logs: any[]): string {
  const lines = logs.map(log => {
    const statusPart = log.status !== undefined ? `${log.status}` : 'FAIL';
    const durationPart = log.durationMs !== undefined ? `(${log.durationMs}ms)` : '';
    const typePart = log.resourceType ? `[${log.resourceType}]` : '';
    let line = `[${log.method}] ${statusPart} ${log.url} ${durationPart} ${typePart}`.replace(/\s+/g, ' ').trim();

    if (log.error) {
      line += ` -> Error: ${log.error}`;
    } else if (log.responseBodySummary) {
      line += ` -> Response: ${log.responseBodySummary}`;
    }
    return line;
  });

  return `[${logs.length} network requests recorded (dynamic only by default, capped at limit)]\n` + lines.join('\n');
}

export function registerNetworkTool(server: McpServer): void {
  const networkSchema = {
    filter: z
      .string()
      .optional()
      .describe('Filter string or regex pattern for URLs (e.g. "/api/", "users", "graphql")'),
    statusFilter: z
      .enum(['all', 'errors_only', '4xx', '5xx'])
      .optional()
      .describe('Filter by HTTP status: "all", "errors_only" (>= 400 or network failure), "4xx", "5xx" (default: "all")'),
    includeStaticAssets: z
      .boolean()
      .optional()
      .describe('Include static assets such as CSS, fonts, images, media (default: false, only fetch/xhr/document to prevent context rot)'),
    limit: z
      .number()
      .optional()
      .describe('Maximum number of recent log entries to return (default: 25)'),
    format: z
      .enum(['compact', 'verbose'])
      .optional()
      .describe('Output format: "compact" (token-lean 1 line per request) or "verbose" (full JSON) (default: "compact")'),
    clearAfterRead: z
      .boolean()
      .optional()
      .describe('Clear log buffer after reading so subsequent calls only return new logs (default: true)')
  };

  const networkHandler = instrumentHandler(
    'spector_get_network_logs',
    async ({ filter, clearAfterRead, statusFilter, includeStaticAssets, limit, format }: any) => {
    const manager = BrowserManager.getInstance();
    if (!manager.isAttached()) {
      return textResponse('[NOTE: Chrome browser is not attached yet. No network telemetry listeners are active. Run spector_attach to connect.]\nNo network requests recorded matching the criteria.');
    }
    const logs = manager.getNetworkLogs(
      filter,
      clearAfterRead ?? true,
      statusFilter,
      includeStaticAssets ?? false,
      limit ?? 25
    );

    if (logs.length === 0) {
      return textResponse('No network requests recorded matching the criteria.');
    }

    const outputText =
      (format ?? 'compact') === 'verbose'
        ? JSON.stringify(logs, null, 2)
        : formatCompactNetworkLogs(logs);

    return textResponse(outputText);
  });

  server.tool(
    'spector_get_network_logs',
    '[TELEMETRY: API & NETWORK AUDIT] Captures network requests and responses (XHR, fetch, API payloads, HTTP 4xx/5xx status). Filters static assets by default and returns compact summaries to prevent context rot. Use when forms fail to submit, API data does not render, or investigating backend payloads.',
    networkSchema,
    networkHandler
  );

  const mockSchema = {
    action: z
      .enum(['set', 'clear', 'list'])
      .describe('Mock action: "set" (register new route mock), "clear" (remove specific or all mock routes), "list" (inspect active mocks)'),
    urlPattern: z
      .string()
      .optional()
      .describe('URL endpoint pattern (glob string or wildcard, e.g. "**/api/users/**", "*/v1/products", "https://api.example.com/*")'),
    status: z
      .number()
      .optional()
      .describe('Simulated HTTP status code (default: 200, or 400, 422, 500 for error testing)'),
    body: z
      .string()
      .optional()
      .describe('Response body payload (JSON string or plain text)'),
    contentType: z
      .string()
      .optional()
      .describe('Response content-type header (default: "application/json")'),
    delayMs: z
      .number()
      .optional()
      .describe('Simulated network latency in milliseconds (e.g. 1000 for 1 second)')
  };

  const mockHandler = instrumentHandler(
    'spector_mock_network',
    async ({ action, urlPattern, status, body, contentType, delayMs }: any) => {
      const manager = BrowserManager.getInstance();

      if (action === 'set') {
        if (!urlPattern) {
          throw new Error('Parameter "urlPattern" is required when action is "set".');
        }
        const rule = await manager.setNetworkMock({
          urlPattern,
          status,
          body,
          contentType,
          delayMs
        });
        return textResponse(`[MOCK ACTIVE] Route "${rule.urlPattern}" successfully intercepted -> Status: ${rule.status}, Type: ${rule.contentType}`);
      }

      if (action === 'clear') {
        const res = await manager.clearNetworkMock(urlPattern);
        return textResponse(`[MOCKS CLEARED] Cleared ${res.clearedCount} mock rule(s). Active remaining: ${res.remaining.length > 0 ? res.remaining.join(', ') : 'none'}`);
      }

      if (action === 'list') {
        const activeRules = manager.listNetworkMocks();
        if (activeRules.length === 0) {
          return textResponse('No active network mock rules.');
        }
        const summary = activeRules
          .map(r => `• [${r.status}] ${r.urlPattern} (${r.contentType || 'application/json'}${r.delayMs ? `, delay: ${r.delayMs}ms` : ''})`)
          .join('\n');
        return textResponse(`[ACTIVE NETWORK MOCKS: ${activeRules.length}]\n${summary}`);
      }

      throw new Error(`Unknown action: "${action}". Must be "set", "clear", or "list".`);
    }
  );

  server.tool(
    'spector_mock_network',
    '[NETWORK TESTBED: EPHEMERAL ROUTE MOCKING] Set, clear, or inspect ephemeral network route interceptors in the browser page without touching the backend database. Useful for verifying UI responses to 400, 422, 500 statuses, simulating network latency/timeouts, or testing empty/error state rendering.',
    mockSchema,
    mockHandler
  );
}
