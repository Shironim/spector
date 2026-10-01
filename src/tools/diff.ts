import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { jsonResponse } from '../types.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export function registerDiffTool(server: McpServer): void {
  const diffSchema = {
    selector: z
      .string()
      .optional()
      .describe('Root CSS selector to scope comparison to a specific container (e.g. "#app", "main")'),
    resetBaseline: z
      .boolean()
      .optional()
      .describe('Set to true to capture a fresh baseline from current DOM state')
  };

  const diffHandler = instrumentHandler(
    'spector_diff_dom',
    async ({ selector, resetBaseline }: any) => {
      const manager = BrowserManager.getInstance();
      const result = await manager.diffDom(selector, resetBaseline ?? false);

      let message = '';
      if (result.status === 'baseline_set') {
        message = `Baseline DOM snapshot recorded at ${result.currentTimestamp}. Perform UI interactions or code modifications, then call spector_diff_dom again to inspect changes.`;
      } else {
        const { addedCount, removedCount, mutatedCount, textChangesCount } = result.summary;
        message = `DOM comparison: +${addedCount} added, -${removedCount} removed, ~${mutatedCount} mutated (${textChangesCount} text changes).`;
      }

      return jsonResponse({
        summaryMessage: message,
        ...result
      });
    }
  );

  server.tool(
    'spector_diff_dom',
    '[SEMANTIC UI VERIFICATION & TOKEN SAVER] Compares current DOM snapshot against the pre-action baseline (or establishes a fresh baseline). Returns structural mutation delta (added/removed elements, text edits, and bounding box shifts). Use after clicks, form submissions, or code edits to verify visual state changes with minimal token overhead.',
    diffSchema,
    diffHandler
  );
}
