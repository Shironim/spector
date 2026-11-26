import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import { runLayoutForensics } from '../analyzers/layout-forensics.js';
import { explainCssCascade } from '../analyzers/cdp-styles.js';
import { escapeTailwindSelector } from '../utils/selector.js';
import type { BreakpointAuditItem, BreakpointTargetLayout, DiagnoseReport } from '../types.js';
import { jsonResponse } from '../utils/mcp-response.js';
import { TIMEOUTS, type BreakpointPreset } from '../constants.js';
import { instrumentHandler } from '../utils/tool-instrument.js';
import { enforceResponseBudget } from '../utils/result-budget.js';
import { evaluateInPage } from '../utils/cdp.js';

export function registerDiagnoseTool(server: McpServer, manager: CdpSessionManager): void {
  const diagnoseSchema = {
    selector: z
      .string()
      .optional()
      .describe('Optional target CSS selector to explain CSS cascade winners/overridden rules via CDP CSS.getMatchedStylesForNode'),
    breakpoints: z
      .array(z.enum(['mobile', 'tablet', 'desktop']))
      .optional()
      .describe('Optional viewports to audit for horizontal overflow (mobile=375x812, tablet=768x1024, desktop=1440x900). Restores original viewport afterward.'),
    consoleLevel: z
      .enum(['error', 'warn', 'all'])
      .optional()
      .default('error')
      .describe('Console log severity filter (default: "error")'),
    clearLogs: z
      .boolean()
      .optional()
      .default(true)
      .describe('Clear returned console/failed-network logs from buffer after reading (default: true)'),
    includeCascade: z
      .boolean()
      .optional()
      .default(true)
      .describe('Run CSS cascade inspection when selector is provided (default: true)'),
    cascadeProperties: z
      .array(z.string())
      .optional()
      .describe('Optional list of CSS property names to inspect in cssCascade (defaults to Spector core layout/visual properties).'),
    runtimeScope: z
      .enum(['active-tab', 'browser-session'])
      .optional()
      .default('active-tab')
      .describe('Scope for consoleErrors and failedNetwork logs (default: "active-tab" to isolate the selected tab; use "browser-session" for all attached tabs)'),
    colorScheme: z
      .enum(['light', 'dark'])
      .optional()
      .describe('Optional prefers-color-scheme media emulation during diagnosis (restored afterward).'),
    reducedMotion: z
      .boolean()
      .optional()
      .describe('Optional prefers-reduced-motion media emulation during diagnosis (restored afterward).')
  };

  server.registerTool(
    'spector_diagnose',
    {
      title: 'Layout, CSS Cascade & Runtime Forensics',
      description: '[UI FORENSICS & CSS CASCADE] Diagnoses horizontal overflow culprits, sticky/content clipping traps, z-index stacking traps, inactive CSS hints, broken images/fonts, CDP CSS cascade overrides, multi-breakpoint overflow, and active-tab console/network errors.',
      inputSchema: diagnoseSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    instrumentHandler<{
      selector?: string;
      breakpoints?: BreakpointPreset[];
      consoleLevel?: 'error' | 'warn' | 'all';
      clearLogs?: boolean;
      includeCascade?: boolean;
      cascadeProperties?: string[];
      runtimeScope?: 'active-tab' | 'browser-session';
      colorScheme?: 'light' | 'dark';
      reducedMotion?: boolean;
    }>('spector_diagnose', async ({ selector, breakpoints, consoleLevel, clearLogs, includeCascade, cascadeProperties, runtimeScope, colorScheme, reducedMotion }) => {
      const page = await manager.ensurePage();
      const operationUrl = manager.pageUrl(page);

      const shouldClear = clearLogs ?? true;
      const scope = runtimeScope ?? 'active-tab';
      const targetIdFilter = scope === 'active-tab' ? manager.targetId(page) : undefined;

      return await manager.withEmulatedMedia({ colorScheme, reducedMotion }, async () => {
        const layoutForensics = await runLayoutForensics(page);

        const cssCascade = selector && includeCascade !== false
          ? await explainCssCascade(page, selector, cascadeProperties, manager.remainingTime(TIMEOUTS.CDP_CONNECT_MS))
          : undefined;

        let breakpointAudits: BreakpointAuditItem[] | undefined;
        if (Array.isArray(breakpoints) && breakpoints.length > 0) {
          const escapedTarget = selector ? escapeTailwindSelector(selector) : undefined;
          breakpointAudits = await manager.withBreakpointMetrics(breakpoints, async (bp, dims) => {
            const report = await runLayoutForensics(page);
            const targetLayout = escapedTarget
              ? await collectBreakpointTargetLayout(page, escapedTarget)
              : undefined;
            return {
              breakpoint: bp,
              coverage: report.coverage,
              width: dims.width,
              height: dims.height,
              hasHorizontalOverflow: report.horizontalOverflow.hasOverflow,
              overflowCulpritsCount: report.horizontalOverflow.culprits.length,
              ...(report.horizontalOverflow.culprits[0] ? { topCulprit: report.horizontalOverflow.culprits[0].selector } : {}),
              ...(targetLayout ? { targetLayout } : {})
            };
          }, page);
        }

        manager.assertTarget(page, operationUrl);
        const metadata = await manager.captureMetadata(page, selector);
        manager.assertTarget(page, operationUrl);
        const report: DiagnoseReport = {
          url: metadata.url,
          viewport: page.viewportSize(),
          runtimeHealth: {
            scope,
            consoleErrors: manager.telemetry.getConsoleLogs(consoleLevel ?? 'error', false, undefined, targetIdFilter),
            failedNetwork: manager.telemetry.getFailedNetworkLogs(false, undefined, undefined, targetIdFilter)
          },
          layoutForensics,
          ...(cssCascade ? { cssCascade } : {}),
          ...(breakpointAudits ? { breakpointAudits } : {})
        };

        const response = enforceResponseBudget(jsonResponse({ ...report, metadata }));
        manager.assertTarget(page, operationUrl);
        if (shouldClear) {
          manager.telemetry.getConsoleLogs(consoleLevel ?? 'error', true, undefined, targetIdFilter);
          manager.telemetry.getFailedNetworkLogs(true, undefined, undefined, targetIdFilter);
        }
        return response;
      }, page);
    }, operation => manager.runBrowserOperation(operation))
  );
}

async function collectBreakpointTargetLayout(
  page: import('playwright-core').Page,
  escapedSelector: string
): Promise<BreakpointTargetLayout | undefined> {
  return await evaluateInPage(page, (sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return undefined;
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return {
      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      display: cs.display,
      ...(cs.display.includes('flex') ? { flexDirection: cs.flexDirection } : {}),
      ...(cs.gridTemplateColumns && cs.gridTemplateColumns !== 'none' ? { gridTemplateColumns: cs.gridTemplateColumns } : {}),
      fontSize: cs.fontSize,
      ...(cs.visibility !== 'visible' ? { visibility: cs.visibility } : {})
    };
  }, escapedSelector) ?? undefined;
}
