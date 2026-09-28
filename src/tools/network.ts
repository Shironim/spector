import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { textResponse } from '../types.js';

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
      .describe('Filter string atau regex untuk URL (e.g. "/api/", "users", "graphql")'),
    statusFilter: z
      .enum(['all', 'errors_only', '4xx', '5xx'])
      .optional()
      .describe('Filter berdasarkan status HTTP: "all", "errors_only" (>= 400 atau network failed), "4xx", "5xx" (default: "all")'),
    includeStaticAssets: z
      .boolean()
      .optional()
      .describe('Sertakan aset statis seperti CSS, font, gambar, media (default: false, hanya fetch/xhr/document untuk mencegah context rot)'),
    limit: z
      .number()
      .optional()
      .describe('Batas maksimal entri log terbaru yang dikembalikan (default: 25)'),
    format: z
      .enum(['compact', 'verbose'])
      .optional()
      .describe('Format output: "compact" (ringkasan 1 baris/request, sangat hemat token) atau "verbose" (full JSON) (default: "compact")'),
    clearAfterRead: z
      .boolean()
      .optional()
      .describe('Hapus buffer log setelah dibaca agar pemanggilan berikutnya hanya mendapat log baru (default: true)')
  };

  const networkHandler = async ({ filter, clearAfterRead, statusFilter, includeStaticAssets, limit, format }: any) => {
    const manager = BrowserManager.getInstance();
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
  };

  server.tool(
    'spector_get_network_logs',
    '[TELEMETRY: API & NETWORK AUDIT] Mengambil log network request/response (XHR, fetch, API payload, HTTP status 4xx/5xx). Secara default memfilter asset statis dan mengembalikan ringkasan compact untuk mencegah context rot. Gunakan saat form gagal submit, data API tidak tampil, atau ingin memeriksa payload backend.',
    networkSchema,
    networkHandler
  );

  server.tool('browser_get_network_logs', '[Alias for spector_get_network_logs]', networkSchema, networkHandler);
}
