import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import { applyPreviewCss, type PreviewAction, type PreviewEvalResult } from '../browser/preview-css.js';
import type { McpToolResponse } from '../types.js';
import { envelopeResponse } from '../utils/mcp-response.js';
import { instrumentHandler } from '../utils/tool-instrument.js';

const PREVIEW_FORMATTERS: Record<PreviewAction, (res: PreviewEvalResult) => McpToolResponse> = {
  clear: (res) => envelopeResponse(true, 'Cleared temporary Spector preview stylesheet.', res),
  get: (res) =>
    envelopeResponse(true, res.active ? 'Preview stylesheet is active.' : 'No preview stylesheet active.', res),
  apply: (res) =>
    envelopeResponse(true, `Applied temporary CSS preview (${res.css.length} chars).`, { length: res.css.length }),
  append: (res) =>
    envelopeResponse(true, `Applied temporary CSS preview (${res.css.length} chars).`, { length: res.css.length })
};

export function registerPreviewCssTool(server: McpServer, manager: CdpSessionManager): void {
  const schema = {
    action: z
      .enum(['apply', 'append', 'clear', 'get'])
      .describe('"apply" replaces preview CSS, "append" adds rules, "clear" removes preview tag, "get" reads current preview CSS'),
    css: z
      .string()
      .optional()
      .describe('CSS text to inject inside <style id="spector-live-preview"> (required for "apply" and "append")')
  };

  server.tool(
    'spector_preview_css',
    '[EPHEMERAL CSS SANDBOX] Injects or clears temporary <style id="spector-live-preview"> overrides in the active browser tab to validate visual adjustments before editing project files.',
    schema,
    instrumentHandler<{ action: PreviewAction; css?: string }>(
      'spector_preview_css',
      async ({ action, css }) => {
        const page = await manager.ensurePage();
        const result = await applyPreviewCss(page, action, css);
        return PREVIEW_FORMATTERS[action](result);
      }, operation => manager.runBrowserOperation(operation)
    )
  );
}
