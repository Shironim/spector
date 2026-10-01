import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { textResponse } from '../types.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export function registerDomTool(server: McpServer): void {
  const domSchema = {
    selector: z
      .string()
      .optional()
      .describe('Root CSS selector to scope inspection to a specific component or container (e.g. "#main-card", ".modal")'),
    includeBoundingBox: z
      .boolean()
      .optional()
      .describe('Include pixel bounding box coordinates [box=x,y,w,h] (default: true)'),
    includeOffscreen: z
      .boolean()
      .optional()
      .describe('Include elements outside the active viewport (sliders, carousels, off-screen drawers) or animated fade-in elements (default: false)')
  };

  const domHandler = instrumentHandler(
    'spector_get_dom_tree',
    async ({ selector, includeBoundingBox, includeOffscreen }: any) => {
      const manager = BrowserManager.getInstance();
      const domTree = await manager.getDomTree(selector, includeBoundingBox ?? true, includeOffscreen ?? false);

      return textResponse(domTree);
    }
  );

  server.tool(
    'spector_get_dom_tree',
    '[READ-ONLY MAP & TOKEN-LEAN DOM] Retrieves an LLM-optimized semantic DOM tree (token-lean). Use when assessing macro UI layout or component hierarchy. NOTE: To verify UI changes after clicks, inputs, or code mutations, prioritize spector_diff_dom or spector_pick_element over re-dumping the full DOM tree to prevent context rot.',
    domSchema,
    domHandler
  );
}
