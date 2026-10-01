import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { textResponse } from '../types.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export function registerInteractTool(server: McpServer): void {
  const interactSchema = {
    action: z
      .enum(['click', 'type', 'fill', 'hover', 'scroll', 'scrollIntoView', 'press_key'])
      .describe('User action to dispatch: "click", "hover", "type", "fill", "scroll", "scrollIntoView" (scrolls target directly into center of viewport), "press_key"'),
    selector: z
      .string()
      .optional()
      .describe('Target element CSS selector (required for click, type, fill, hover, scrollIntoView)'),
    text: z
      .string()
      .optional()
      .describe('Text to input when action is "type" or "fill"'),
    clearFirst: z
      .boolean()
      .optional()
      .describe('Clear existing text before typing when action is "type" (default: false)'),
    key: z
      .string()
      .optional()
      .describe('Keyboard key code when action is "press_key" (e.g. "Enter", "Escape", "Tab")'),
    scrollDelta: z
      .object({
        x: z.number().optional().describe('Horizontal scroll delta in pixels'),
        y: z.number().optional().describe('Vertical scroll delta in pixels')
      })
      .optional()
      .describe('Scroll delta dimensions when action is "scroll"'),
    scrollX: z
      .number()
      .optional()
      .describe('Shortcut for horizontal scroll delta (alternative to scrollDelta.x)'),
    scrollY: z
      .number()
      .optional()
      .describe('Shortcut for vertical scroll delta (alternative to scrollDelta.y, default: 300 if omitted)'),
    waitForNavigation: z
      .boolean()
      .optional()
      .describe('Wait for page navigation or URL transition to finish after click interaction (default: false)'),
    waitForTimeoutMs: z
      .number()
      .optional()
      .describe('Additional delay (ms) after interaction to allow CSS animations or UI re-renders to settle (default: 0)')
  };

  const interactHandler = instrumentHandler(
    'spector_interact',
    async ({ action, selector, text, clearFirst, key, scrollDelta, scrollX, scrollY, waitForNavigation, waitForTimeoutMs }: any) => {
      const manager = BrowserManager.getInstance();
      const effectiveDelta = (scrollDelta || scrollX !== undefined || scrollY !== undefined)
        ? {
            x: scrollDelta?.x ?? scrollX ?? 0,
            y: scrollDelta?.y ?? scrollY ?? 300
          }
        : undefined;

      const message = await manager.interact(
        action,
        selector,
        text,
        key,
        effectiveDelta,
        clearFirst ?? false,
        waitForNavigation ?? false,
        waitForTimeoutMs ?? 0
      );

      return textResponse(message);
    }
  );

  server.tool(
    'spector_interact',
    '[AUTOMATION: USER DISPATCH] Dispatches simulated user interactions on page elements (click, type, fill, hover, scroll, press_key) with auto-waiting to verify form flows and UI state transitions.',
    interactSchema,
    interactHandler
  );
}
