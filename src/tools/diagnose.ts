import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpSessionManager } from '../browser/cdp-session.js';
import { runLayoutForensics } from '../analyzers/layout-forensics.js';
import { explainCssCascade } from '../analyzers/cdp-styles.js';
import { runAnimationForensics } from '../analyzers/animation-forensics.js';
import { escapeTailwindSelector } from '../utils/selector.js';
import type { BreakpointAuditItem, BreakpointTargetLayout, DiagnoseReport } from '../types.js';
import { jsonResponse } from '../utils/mcp-response.js';
import { TIMEOUTS, type BreakpointPreset } from '../constants.js';
import { instrumentHandler } from '../utils/tool-instrument.js';
import { enforceResponseBudget } from '../utils/result-budget.js';

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
    includeAnimations: z
      .boolean()
      .optional()
      .default(true)
      .describe('Extract active CSS/WAAPI animations, timing, keyframes, and stagger patterns (default: true)')
  };

  server.tool(
    'spector_diagnose',
    '[UNIFIED UI FORENSICS & RUNTIME HEALTH] Diagnoses horizontal overflow culprits, sticky/content clipping traps, z-index stacking traps, inactive CSS hints, broken images/fonts, CSS cascade overrides, active animations/keyframes, multi-breakpoint overflow, deduplicated console errors, and failed network requests.',
    diagnoseSchema,
    instrumentHandler<{
      selector?: string;
      breakpoints?: BreakpointPreset[];
      consoleLevel?: 'error' | 'warn' | 'all';
      clearLogs?: boolean;
      includeCascade?: boolean;
      includeAnimations?: boolean;
    }>('spector_diagnose', async ({ selector, breakpoints, consoleLevel, clearLogs, includeCascade, includeAnimations }) => {
      const page = await manager.ensurePage();
      const operationUrl = page.url();

      const shouldClear = clearLogs ?? true;
      const layoutForensics = await runLayoutForensics(page);

      const cssCascade = selector && includeCascade !== false
        ? await explainCssCascade(page, selector, undefined, manager.remainingTime(TIMEOUTS.CDP_CONNECT_MS))
        : undefined;

      const animations = includeAnimations !== false
        ? await runAnimationForensics(page, selector)
        : undefined;

      let breakpointAudits: BreakpointAuditItem[] | undefined;
      if (Array.isArray(breakpoints) && breakpoints.length > 0) {
        const escapedTarget = selector ? escapeTailwindSelector(selector) : undefined;
        breakpointAudits = await manager.withBreakpointMetrics(breakpoints, async (bp, dims) => {
          const report = await runLayoutForensics(page);
          let targetLayout: BreakpointTargetLayout | undefined;
          if (escapedTarget) {
            targetLayout = await page.evaluate((sel: string) => {
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
            }, escapedTarget) ?? undefined;
          }
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
          scope: 'browser-session',
          consoleErrors: manager.telemetry.getConsoleLogs(consoleLevel ?? 'error', false),
          failedNetwork: manager.telemetry.getFailedNetworkLogs(false)
        },
        layoutForensics,
        ...(cssCascade ? { cssCascade } : {}),
        ...(Array.isArray(animations?.animations) && animations.animations.length > 0 ? { animations } : {}),
        ...(breakpointAudits ? { breakpointAudits } : {})
      };

      const response = enforceResponseBudget(jsonResponse({ ...report, metadata }));
      manager.assertTarget(page, operationUrl);
      if (shouldClear) {
        manager.telemetry.getConsoleLogs(consoleLevel ?? 'error', true);
        manager.telemetry.getFailedNetworkLogs(true);
      }
      return response;
    }, operation => manager.runBrowserOperation(operation))
  );
}
