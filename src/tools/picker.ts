import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import type { McpToolContent, PickedElementInfo, PinRole, PinSelectionMode } from '../types.js';
import { envelopeResponse, failSafeResponse, SpectorError } from '../utils/mcp-response.js';
import { instrumentHandler } from '../utils/tool-instrument.js';
import { TIMEOUTS } from '../constants.js';
import { enforceResponseBudget } from '../utils/result-budget.js';

function stripImageForJson(pin: PickedElementInfo) {
  const { screenshotBase64: _img, ...rest } = pin;
  return rest;
}

function buildPickedResponse(pins: PickedElementInfo[], comparison?: unknown, includeScreenshot = true): { content: McpToolContent[] } {
  const contentBlocks: McpToolContent[] = [];

  if (pins.length === 1) {
    contentBlocks.push({
      type: 'text',
      text: JSON.stringify(stripImageForJson(pins[0]), null, 2)
    });
  } else {
    contentBlocks.push({
      type: 'text',
      text: JSON.stringify(
        {
          status: 'selected',
          mode: 'multi-pin',
          count: pins.length,
          pins: pins.map(stripImageForJson),
          ...(comparison ? { comparison } : {})
        },
        null,
        2
      )
    });
  }

  for (const pin of pins) {
    if (includeScreenshot && pin.screenshotBase64) {
      contentBlocks.push({
        type: 'image',
        data: pin.screenshotBase64,
        mimeType: 'image/png'
      });
    }
  }

  return { content: contentBlocks };
}

export function registerPickerTools(server: McpServer, manager: CdpSessionManager): void {
  const pickerSchema = {
    action: z
      .enum(['get', 'pick', 'snapshot', 'verify', 'clear'])
      .optional()
      .default('get')
      .describe('"get" retrieves Alt+P pinned blueprint(s)/comparison; "pick" launches interactive overlay; "snapshot" programmatically pins a CSS selector as a Before/After baseline (no Alt+P needed); "verify" re-checks a pinned/snapshotted selector after code edits and returns Before vs After rect/style/forensics deltas; "clear" empties pin queue (default: "get")'),
    selector: z
      .string()
      .optional()
      .describe('Target CSS selector to capture when action is "snapshot" (e.g. "main", "#pricing-card")'),
    note: z
      .string()
      .optional()
      .describe('Optional label/note attached to a programmatic snapshot when action is "snapshot"'),
    pinId: z
      .string()
      .optional()
      .describe('Optional pin ID to verify when action is "verify" (defaults to latest Target/Single element pin)'),
    includeScreenshot: z
      .boolean()
      .optional()
      .default(true)
      .describe('Include cropped screenshot(s); set false for a smaller response without losing pin metadata (default: true)'),
    clearAfterRead: z
      .boolean()
      .optional()
      .default(false)
      .describe('Clear cached pin(s) after reading when action is "get" (default: false)'),
    includeHoverState: z
      .boolean()
      .optional()
      .default(false)
      .describe('Force :hover pseudo-state via CDP to extract exact hover style deltas & transitions (default: false)'),
    includeFocusState: z
      .boolean()
      .optional()
      .default(false)
      .describe('Also enrich active-tab pin with CDP :focus-visible pseudo-state delta when action is "get" (default: false)'),
    timeoutMs: z
      .number()
      .optional()
      .default(TIMEOUTS.PICKER_HOTKEY_DEFAULT_MS)
      .describe('Timeout in milliseconds waiting for developer selection when action is "pick" (default: 30000)'),
    includeStyles: z
      .boolean()
      .optional()
      .default(true)
      .describe('Extract typography, layout, surface styles, subtree summary, and SVG/image asset metadata when action is "pick" (default: true)'),
    role: z
      .enum(['single', 'target', 'reference', 'pin'])
      .optional()
      .default('single')
      .describe('Initial pin slot role when action is "pick": "single", "target" (project A), "reference" (ref B), or "pin" (multi-pin queue)'),
    selectionMode: z
      .enum(['element', 'region'])
      .optional()
      .default('element')
      .describe('Initial selection hint when action is "pick" (overlay supports both click-element and drag-region automatically)')
  };

  server.registerTool(
    'spector_picker',
    {
      title: 'Visual Pin Picker, A/B Compare & Before/After Verify',
      description: '[HUMAN-TO-AI VISUAL PICKER & VERIFIER] Retrieves Alt+P pinned Design Blueprint(s) with auto-forensics (action: "get"), launches the point-then-annotate overlay (action: "pick"), verifies Before vs After diffs on a pinned element after code edits (action: "verify"), or clears the pin queue (action: "clear").',
      inputSchema: pickerSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    instrumentHandler<{
      action?: 'get' | 'pick' | 'snapshot' | 'verify' | 'clear';
      selector?: string;
      note?: string;
      pinId?: string;
      includeScreenshot?: boolean;
      clearAfterRead?: boolean;
      includeHoverState?: boolean;
      includeFocusState?: boolean;
      timeoutMs?: number;
      includeStyles?: boolean;
      role?: PinRole;
      selectionMode?: PinSelectionMode;
    }>('spector_picker', async ({
      action,
      selector,
      note,
      pinId,
      includeScreenshot,
      clearAfterRead,
      includeHoverState,
      includeFocusState,
      timeoutMs,
      includeStyles,
      role,
      selectionMode
    }) => {
      if (action === 'clear') {
        const cleared = manager.clearPins();
        return envelopeResponse(true, `Cleared ${cleared} pinned item(s) from Spector queue.`, { cleared });
      }

      if (action === 'snapshot') {
        if (!selector || !selector.trim()) {
          return failSafeResponse(
            'spector_picker',
            new SpectorError('INVALID_TOOL_INPUT', 'selector is required when action is "snapshot".'),
            'Provide a valid CSS selector, e.g. spector_picker({ action: "snapshot", selector: "main" }).'
          );
        }
        const snap = await manager.snapshotSelector({
          selector,
          role: role ?? 'single',
          note,
          includeScreenshot: includeScreenshot ?? false,
          includeHoverState: includeHoverState ?? false
        });
        return enforceResponseBudget(buildPickedResponse([snap.pin], snap.comparison, includeScreenshot ?? false));
      }

      if (action === 'verify') {
        const verified = await manager.verifyPin({
          pinId,
          includeScreenshot: includeScreenshot ?? true
        });
        const content: McpToolContent[] = [
          { type: 'text', text: JSON.stringify(verified.report, null, 2) }
        ];
        if (includeScreenshot !== false && verified.screenshotBase64) {
          content.push({
            type: 'image',
            data: verified.screenshotBase64,
            mimeType: 'image/png'
          });
        }
        return enforceResponseBudget({ content });
      }

      if (action === 'pick') {
        const result = await manager.pickElement({
          timeoutMs: timeoutMs ?? TIMEOUTS.PICKER_HOTKEY_DEFAULT_MS,
          includeScreenshot: includeScreenshot ?? true,
          includeStyles: includeStyles ?? true,
          includeHoverState: includeHoverState ?? false,
          role: role ?? 'single',
          selectionMode: selectionMode ?? 'element'
        });

        if (result.status === 'cancelled') {
          return failSafeResponse(
            'spector_picker',
            new SpectorError('PICKER_CANCELLED', 'Element selection was cancelled by the user (Escape pressed).'),
            'Call spector_picker({ action: "pick" }) again and select a target before cancelling.'
          );
        }

        if (result.status === 'timeout' || result.pins.length === 0) {
          return failSafeResponse(
            'spector_picker',
            new SpectorError('OPERATION_TIMEOUT', 'Element selection timed out; no element or region was picked.'),
            'Call spector_picker({ action: "pick" }) again and select the target before the timeout.'
          );
        }

        return enforceResponseBudget(buildPickedResponse(result.pins, result.comparison, includeScreenshot ?? true));
      }

      if (!manager.isAttached()) {
        return failSafeResponse(
          'spector_picker',
          new SpectorError('BROWSER_NOT_ATTACHED', 'Chrome browser is not attached; Alt+P picking requires an active Chrome session.'),
          'Call spector_attach to connect Chrome, then pick an element with Alt+P or spector_picker({ action: "pick" }).'
        );
      }

      const readPicked = () => manager.getLastPicked({
        includeScreenshot: includeScreenshot ?? true,
        clearAfterRead: false,
        includeHoverState: includeHoverState ?? false,
        includeFocusState: includeFocusState ?? false
      });
      const result = includeHoverState || includeFocusState
        ? await manager.runBrowserOperation(readPicked)
        : await readPicked();

      if (!result || result.pins.length === 0) {
        return failSafeResponse(
          'spector_picker',
          new SpectorError('NO_PICKED_ELEMENT', 'No element or section has been picked yet.'),
          'Pick a target with Alt+P in an attached Chrome tab or call spector_picker({ action: "pick" }), then retry.'
        );
      }

      const response = enforceResponseBudget(buildPickedResponse(result.pins, result.comparison, includeScreenshot ?? true));
      if (clearAfterRead) manager.pins.consume(result.pins);
      return response;
    })
  );
}
