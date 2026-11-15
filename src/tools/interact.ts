import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import type { InteractAction } from '../browser/interactions.js';
import { envelopeResponse } from '../utils/mcp-response.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export function registerInteractTool(server: McpServer, manager: CdpSessionManager): void {
  const interactSchema = {
    value: z.string().optional().describe('Text for fill, key chord for pressKey (e.g. Tab), or native select option value'),
    expectedUrl: z.string().optional().describe('Exact URL precondition; interaction may intentionally navigate afterward'),
    action: z
      .enum(['click', 'hover', 'scroll', 'scrollIntoView', 'fill', 'pressKey', 'selectOption'])
      .describe('UI interaction including text input, targeted keyboard and native select controls'),
    selector: z
      .string()
      .optional()
      .describe('Target element CSS selector (required for click, hover, scrollIntoView; optional for scroll)'),
    scrollDelta: z
      .object({
        x: z.number().optional().describe('Horizontal scroll delta in pixels'),
        y: z.number().optional().describe('Vertical scroll delta in pixels')
      })
      .optional()
      .describe('Scroll delta in pixels when action is "scroll" (default: { x: 0, y: 300 })'),
    waitForTimeoutMs: z
      .number()
      .int().min(0).max(30000)
      .optional()
      .default(0)
      .describe('Additional delay (ms) after interaction to let CSS transitions/state settle (default: 0)')
  };

  server.tool(
    'spector_interact',
    '[UI STATE DISPATCHER] Opens interactive UI states (dropdowns, modals, tabs, hover states, scrolled sections) using click, hover, scroll, or scrollIntoView.',
    interactSchema,
    instrumentHandler<{
      value?: string;
      expectedUrl?: string;
      action: InteractAction;
      selector?: string;
      scrollDelta?: { x?: number; y?: number };
      waitForTimeoutMs?: number;
    }>('spector_interact', async ({ action, selector, scrollDelta, waitForTimeoutMs, value, expectedUrl }) => {
      const delta = scrollDelta ? { x: scrollDelta.x ?? 0, y: scrollDelta.y ?? 0 } : undefined;
      const message = await manager.interact(action, selector, delta, waitForTimeoutMs ?? 0, value, expectedUrl);
      return envelopeResponse(true, message);
    }, operation => manager.runBrowserOperation(operation, true))
  );
}
