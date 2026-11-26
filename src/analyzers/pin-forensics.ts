import type { Page } from 'playwright-core';
import type {
  BoundingRect,
  CssCascadeReport,
  PickedElementInfo,
  PinForensicsSummary,
  PinLayoutIssue,
  PinVerificationReport
} from '../types.js';
import { TIMEOUTS } from '../constants.js';
import { evaluateInPage } from '../utils/cdp.js';
import { escapeTailwindSelector, IN_BROWSER_CSS_SELECTOR_FN } from '../utils/selector.js';
import { explainCssCascade } from './cdp-styles.js';

/**
 * Pure helper: distills a CssCascadeReport down to only properties that have
 * overridden author declarations, keeping pinned evidence token-lean.
 */
export function summarizeCascadeOverrides(
  cascade: CssCascadeReport
): PinForensicsSummary['overriddenCss'] {
  const overriddenCss: NonNullable<PinForensicsSummary['overriddenCss']> = {};
  for (const [prop, entry] of Object.entries(cascade.properties)) {
    if (!entry.overridden || entry.overridden.length === 0) continue;
    overriddenCss[prop] = {
      winningValue: entry.winningValue,
      winningSource: entry.winningSource,
      overriddenCount: entry.overridden.length,
      topOverridden: entry.overridden[0]
    };
  }
  return Object.keys(overriddenCss).length > 0 ? overriddenCss : undefined;
}

/**
 * Runs targeted O(ancestor-depth) layout/inactive-CSS forensics for a single
 * element selector without scanning the whole document.
 */
async function collectTargetedLayoutIssues(
  page: Page,
  escapedSelector: string
): Promise<PinLayoutIssue[]> {
  const script = `(() => {
    ${IN_BROWSER_CSS_SELECTOR_FN}
    const el = document.querySelector(${JSON.stringify(escapedSelector)});
    if (!el || !(el instanceof HTMLElement)) return [];

    const issues = [];
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;

    if (vw > 0 && rect.width > 0 && rect.right > vw + 1) {
      issues.push({
        kind: 'horizontal-overflow',
        detail: 'Element extends ' + Math.round(rect.right - vw) + 'px past viewport right edge.'
      });
    }

    if (cs.position === 'sticky') {
      let ancestor = el.parentElement;
      while (ancestor && ancestor !== document.documentElement) {
        const acs = window.getComputedStyle(ancestor);
        const ov = acs.overflow + ' ' + acs.overflowX + ' ' + acs.overflowY;
        if (/(hidden|clip|scroll|auto)/.test(ov)) {
          issues.push({
            kind: 'sticky-clipped-by-ancestor',
            detail: 'Sticky positioning blocked by ancestor overflow (' + acs.overflow + ').',
            ancestorSelector: getCssSelector(ancestor)
          });
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2) {
      issues.push({
        kind: 'content-clipped',
        detail: 'Horizontal content clipped (scrollWidth=' + el.scrollWidth + ' > clientWidth=' + el.clientWidth + ').'
      });
    }

    const zNum = Number(cs.zIndex);
    if (cs.position !== 'static' && Number.isFinite(zNum) && zNum !== 0) {
      let ancestor = el.parentElement;
      while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
        const acs = window.getComputedStyle(ancestor);
        const createsContext =
          (acs.position !== 'static' && acs.zIndex !== 'auto') ||
          acs.isolation === 'isolate' ||
          (acs.transform && acs.transform !== 'none') ||
          (acs.filter && acs.filter !== 'none') ||
          Number(acs.opacity) < 1;
        if (createsContext) {
          issues.push({
            kind: 'stacking-trap',
            detail: 'z-index:' + cs.zIndex + ' is trapped inside ancestor stacking context.',
            ancestorSelector: getCssSelector(ancestor)
          });
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    if (cs.position === 'static' && cs.zIndex !== 'auto') {
      issues.push({
        kind: 'inactive-css',
        detail: 'z-index:' + cs.zIndex + ' has no effect on position:static.'
      });
    }
    if (cs.display === 'inline' && (cs.width !== 'auto' || cs.height !== 'auto')) {
      issues.push({
        kind: 'inactive-css',
        detail: 'width/height have no effect on display:inline.'
      });
    }
    if (!cs.display.includes('flex') && !cs.display.includes('grid') && cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') {
      issues.push({
        kind: 'inactive-css',
        detail: 'gap:' + cs.gap + ' has no effect on display:' + cs.display + '.'
      });
    }

    return issues;
  })()`;

  const result = await evaluateInPage(page, script);
  return Array.isArray(result) ? (result as PinLayoutIssue[]) : [];
}

/**
 * Collects compact CSS cascade overrides and targeted layout traps for a pinned
 * element. Returns undefined when no anomalies are found (zero payload noise).
 */
export async function collectPinForensics(
  page: Page,
  selector: string,
  timeoutMs: number = TIMEOUTS.CDP_CONNECT_MS
): Promise<PinForensicsSummary | undefined> {
  const escaped = escapeTailwindSelector(selector);
  const [layoutIssues, cascade] = await Promise.all([
    collectTargetedLayoutIssues(page, escaped).catch(() => [] as PinLayoutIssue[]),
    explainCssCascade(page, selector, undefined, timeoutMs).catch(() => undefined)
  ]);

  const overriddenCss = cascade ? summarizeCascadeOverrides(cascade) : undefined;
  if (!overriddenCss && layoutIssues.length === 0) {
    return undefined;
  }

  return {
    ...(overriddenCss ? { overriddenCss } : {}),
    ...(layoutIssues.length > 0 ? { layoutIssues } : {})
  };
}

function listForensicIssueKeys(forensics?: PinForensicsSummary): string[] {
  if (!forensics) return [];
  const keys: string[] = [];
  if (forensics.layoutIssues) {
    for (const issue of forensics.layoutIssues) {
      keys.push(`${issue.kind}: ${issue.detail}`);
    }
  }
  if (forensics.overriddenCss) {
    for (const [prop, info] of Object.entries(forensics.overriddenCss)) {
      keys.push(`css-override:${prop} (${info.winningValue ?? 'computed'} from ${info.winningSource ?? 'unknown'})`);
    }
  }
  return keys;
}

/**
 * Pure diff function comparing a previously pinned blueprint against a freshly
 * re-captured snapshot of the same selector after code edits / HMR.
 */
export function computePinVerificationDiff(
  beforePin: PickedElementInfo,
  after: {
    rect?: BoundingRect;
    computedStyles?: Record<string, string>;
    forensics?: PinForensicsSummary;
  }
): PinVerificationReport {
  const styleChanges: Record<string, { before?: string; after?: string }> = {};
  const beforeStyles = beforePin.computedStyles ?? {};
  const afterStyles = after.computedStyles ?? {};
  const allKeys = new Set([...Object.keys(beforeStyles), ...Object.keys(afterStyles)]);
  for (const key of allKeys) {
    if (beforeStyles[key] !== afterStyles[key]) {
      styleChanges[key] = {
        before: beforeStyles[key],
        after: afterStyles[key]
      };
    }
  }

  const rectDelta =
    beforePin.rect && after.rect
      ? {
          xDiff: after.rect.x - beforePin.rect.x,
          yDiff: after.rect.y - beforePin.rect.y,
          widthDiff: after.rect.width - beforePin.rect.width,
          heightDiff: after.rect.height - beforePin.rect.height,
          before: beforePin.rect,
          after: after.rect
        }
      : undefined;

  const rectChanged = Boolean(
    rectDelta &&
      (rectDelta.xDiff !== 0 ||
        rectDelta.yDiff !== 0 ||
        rectDelta.widthDiff !== 0 ||
        rectDelta.heightDiff !== 0)
  );

  const beforeIssues = new Set(listForensicIssueKeys(beforePin.forensics));
  const afterIssues = new Set(listForensicIssueKeys(after.forensics));

  const resolvedIssues = [...beforeIssues].filter(k => !afterIssues.has(k));
  const remainingIssues = [...afterIssues].filter(k => beforeIssues.has(k));
  const newIssues = [...afterIssues].filter(k => !beforeIssues.has(k));
  const hasForensicsDelta = resolvedIssues.length > 0 || remainingIssues.length > 0 || newIssues.length > 0;

  return {
    status: 'verified',
    pinId: beforePin.id,
    selector: beforePin.selector ?? '',
    ...(beforePin.note ? { note: beforePin.note } : {}),
    changed: rectChanged || Object.keys(styleChanges).length > 0 || resolvedIssues.length > 0 || newIssues.length > 0,
    ...(rectDelta ? { rectDelta } : {}),
    styleChanges,
    ...(hasForensicsDelta
      ? {
          forensicsDelta: {
            resolvedIssues,
            remainingIssues,
            newIssues
          }
        }
      : {}),
    ...(after.forensics ? { afterForensics: after.forensics } : {}),
    verifiedAt: new Date().toISOString()
  };
}
