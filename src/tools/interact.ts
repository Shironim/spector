import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import { escapeTailwindSelector } from '../utils/selector.js';
import { jsonResponse, SpectorError } from '../utils/mcp-response.js';
import { TIMEOUTS } from '../constants.js';
import { instrumentHandler } from '../utils/tool-instrument.js';
import { evaluateInPage } from '../utils/cdp.js';

export function registerInteractTool(server: McpServer, manager: CdpSessionManager): void {
  const interactSchema = {
    action: z
      .enum(['click', 'hover', 'scrollTo'])
      .describe('Minimal inspection UI trigger: "click" (open dropdown/tab/modal), "hover" (reveal hover state/tooltip), or "scrollTo" (scroll selector into view or scroll window to y)'),
    selector: z
      .string()
      .optional()
      .describe('Target CSS selector (required for "click" and "hover"; optional for "scrollTo" when y is provided)'),
    y: z
      .number()
      .optional()
      .describe('Vertical pixel offset for action:"scrollTo" when selector is omitted'),
    expectedUrl: z
      .string()
      .optional()
      .describe('Optional exact URL guard checked before performing the interaction'),
    waitAfterMs: z
      .number()
      .int()
      .min(0)
      .max(3000)
      .optional()
      .default(150)
      .describe('Optional settle delay in milliseconds after triggering the UI state (default: 150, max: 3000)'),
    timeoutMs: z
      .number()
      .int()
      .min(500)
      .max(15000)
      .optional()
      .default(TIMEOUTS.INTERACT_DEFAULT_MS)
      .describe(`Action timeout in milliseconds (default: ${TIMEOUTS.INTERACT_DEFAULT_MS})`)
  };

  server.registerTool(
    'spector_interact',
    {
      title: 'Minimal UI Inspection Trigger',
      description: '[MINIMAL UI STATE TRIGGER] Triggers lightweight UI states (click, hover, scrollTo) to open dropdowns, tabs, modals, or scroll sections during visual/CSS inspection. For multi-step forms or E2E flows, use agent-browser.',
      inputSchema: interactSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    instrumentHandler<{
      action: 'click' | 'hover' | 'scrollTo';
      selector?: string;
      y?: number;
      expectedUrl?: string;
      waitAfterMs?: number;
      timeoutMs?: number;
    }>(
      'spector_interact',
      async ({ action, selector, y, expectedUrl, waitAfterMs, timeoutMs }) => {
        const rawSelector = selector?.trim() || undefined;
        if ((action === 'click' || action === 'hover') && !rawSelector) {
          throw new SpectorError('INVALID_TOOL_INPUT', `selector is required when action is "${action}".`);
        }
        if (action === 'scrollTo' && !rawSelector && y === undefined) {
          throw new SpectorError('INVALID_TOOL_INPUT', 'Provide either selector or y when action is "scrollTo".');
        }

        const page = await manager.ensurePage();
        const operationUrl = expectedUrl ?? manager.pageUrl(page);
        manager.assertTarget(page, operationUrl);

        const timeout = timeoutMs ?? TIMEOUTS.INTERACT_DEFAULT_MS;
        const settleMs = waitAfterMs ?? 150;

        if (action === 'click' && rawSelector) {
          const escaped = escapeTailwindSelector(rawSelector);
          await page.locator(escaped).first().click({ timeout });
        } else if (action === 'hover' && rawSelector) {
          const escaped = escapeTailwindSelector(rawSelector);
          await page.locator(escaped).first().hover({ timeout });
        } else if (action === 'scrollTo') {
          if (rawSelector) {
            const escaped = escapeTailwindSelector(rawSelector);
            const found = await evaluateInPage(page, (sel: string) => {
              const el = document.querySelector(sel);
              if (!el) return false;
              el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
              return true;
            }, escaped);
            if (!found) {
              throw new SpectorError('ELEMENT_NOT_READY', `Element not found for scrollTo selector "${rawSelector}".`);
            }
          } else if (y !== undefined) {
            await evaluateInPage(page, (targetY: number) => {
              window.scrollTo(0, targetY);
            }, y);
          }
        }

        if (settleMs > 0) {
          await new Promise(resolve => setTimeout(resolve, settleMs));
        }

        const state = await evaluateInPage(page, () => ({
          scrollY: Math.round(window.scrollY || document.documentElement.scrollTop || 0),
          activeElementTag: document.activeElement?.tagName?.toLowerCase()
        })).catch(() => ({ scrollY: 0, activeElementTag: undefined }));

        return jsonResponse({
          status: 'ok',
          action,
          ...(rawSelector ? { selector: rawSelector } : {}),
          ...(y !== undefined ? { y } : {}),
          url: manager.pageUrl(page),
          scrollY: state.scrollY,
          ...(state.activeElementTag ? { activeElementTag: state.activeElementTag } : {})
        });
      },
      operation => manager.runBrowserOperation(operation)
    )
  );
}
