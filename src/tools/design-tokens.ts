import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import { extractDesignTokens } from '../analyzers/token-extractor.js';
import { jsonResponse } from '../utils/mcp-response.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export function registerDesignTokensTool(server: McpServer, manager: CdpSessionManager): void {
  const schema = {
    includeVariables: z
      .boolean()
      .optional()
      .default(true)
      .describe('Extract :root CSS custom properties (--*) (default: true)'),
    maxPaletteItems: z
      .number()
      .optional()
      .default(8)
      .describe('Maximum colors per palette category (default: 8)')
  };

  server.tool(
    'spector_extract_tokens',
    '[DESIGN DNA EXTRACTOR] Scans :root CSS variables and visible elements on the active tab (e.g. a reference website) to return a distilled palette, typography scale, border radii, shadows, and container widths.',
    schema,
    instrumentHandler<{ includeVariables?: boolean; maxPaletteItems?: number }>(
      'spector_extract_tokens',
      async ({ includeVariables, maxPaletteItems }) => {
        const page = await manager.ensurePage();
        const tokens = await extractDesignTokens(page, {
          includeVariables: includeVariables ?? true,
          maxPaletteItems: maxPaletteItems ?? 8
        });
        const metadata = await manager.captureMetadata(page);
        return jsonResponse({ ...tokens, url: metadata.url, metadata });
      }, operation => manager.runBrowserOperation(operation)
    )
  );
}
