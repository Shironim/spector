import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { textResponse, type McpToolContent } from '../types.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

export function registerPickerTool(server: McpServer): void {
  const pickElementHandler = instrumentHandler(
    'spector_pick_element',
    async ({ timeoutMs, includeScreenshot, includeStyles }: any) => {
    const manager = BrowserManager.getInstance();
    const result = await manager.pickElement(
      timeoutMs ?? 30000,
      includeScreenshot ?? true,
      includeStyles ?? true
    );

    if (result.status === 'cancelled') {
      return textResponse('Element selection was cancelled by the user (Esc pressed).');
    }

    if (result.status === 'timeout') {
      return textResponse('Element selection timed out. No element was clicked.');
    }

    const contentBlocks: McpToolContent[] = [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: 'selected',
            selector: result.selector,
            tagName: result.tagName,
            frameworkComponent: result.frameworkComponent,
            rect: result.rect,
            computedStyles: result.computedStyles,
            domTree: result.domTree
          },
          null,
          2
        )
      }
    ];

    if (result.screenshotBase64) {
      contentBlocks.push({
        type: 'image',
        data: result.screenshotBase64,
        mimeType: 'image/png'
      });
    }

    return {
      content: contentBlocks
    };
  });

  const pickElementSchema = {
    timeoutMs: z
      .number()
      .optional()
      .describe('Timeout in milliseconds waiting for developer to click an element (default: 30000 / 30 seconds)'),
    includeScreenshot: z
      .boolean()
      .optional()
      .describe('Automatically capture a cropped screenshot of the selected element/section (default: true)'),
    includeStyles: z
      .boolean()
      .optional()
      .describe('Extract computed CSS design tokens such as flex/grid layout, colors, typography, border-radius, spacing (default: true)')
  };

  const getLastPickedHandler = instrumentHandler(
    'spector_get_last_picked',
    async ({ clearAfterRead }: any) => {
    const manager = BrowserManager.getInstance();
    const result = manager.getLastPickedElement(clearAfterRead ?? false);

    if (!result) {
      return {
        content: [
          {
            type: 'text',
            text: 'No element or section has been picked yet. You can press Alt + P on any active Chrome browser tab at any time to pick a target section and sync it to Spector AI.'
          }
        ]
      };
    }

    const contentBlocks: any[] = [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: 'selected',
            timestamp: result.timestamp,
            selector: result.selector,
            tagName: result.tagName,
            frameworkComponent: result.frameworkComponent,
            rect: result.rect,
            computedStyles: result.computedStyles,
            domTree: result.domTree
          },
          null,
          2
        )
      }
    ];

    if (result.screenshotBase64) {
      contentBlocks.push({
        type: 'image',
        data: result.screenshotBase64,
        mimeType: 'image/png'
      });
    }

    return {
      content: contentBlocks
    };
  });

  const getLastPickedSchema = {
    clearAfterRead: z
      .boolean()
      .optional()
      .describe('Clear the last picked element cache after reading (default: false)')
  };

  // Primary Spector tools
  server.tool(
    'spector_get_last_picked',
    '[PRIMARY FOR UI FIX & POINT-AND-PROMPT] Retrieves the last element or section picked by the developer via Alt+P in the browser. Call this first whenever the user asks for styling fixes (padding, colors, layout, fonts) or mentions "the element I just clicked". Returns precise CSS selectors, computed design tokens, token-lean accessibility DOM tree, framework component origin (with clickable file links), and cropped screenshot.',
    getLastPickedSchema,
    getLastPickedHandler
  );

  server.tool(
    'spector_pick_element',
    '[PROACTIVE PICK] Activates interactive visual inspector overlay on the browser screen and waits for developer to click the target component. Returns unique CSS selector, design tokens, DOM tree, framework origin, and screenshot.',
    pickElementSchema,
    pickElementHandler
  );

  // Backward-compatibility aliases
  server.tool('browser_get_last_picked', '[Alias for spector_get_last_picked]', getLastPickedSchema, getLastPickedHandler);
  server.tool('browser_pick_element', '[Alias for spector_pick_element]', pickElementSchema, pickElementHandler);
}
