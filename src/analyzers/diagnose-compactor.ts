import type {
  AccessibilityForensicsReport,
  BreakpointAuditItem,
  DiagnoseReport,
  LayoutForensicsReport,
  TouchTargetIssueItem
} from '../types.js';
import { normalizeSelectorPattern } from '../utils/selector.js';

export interface GroupedIssue<T> {
  count: number;
  pattern: string;
  sampleSelector: string;
  sourceFile?: string;
  sample: T;
}

function groupBySignature<T extends { selector: string; sourceFile?: string }>(
  items: T[],
  signatureFn: (item: T, pattern: string) => string,
  sampleMapper: (item: T) => Record<string, unknown>
): Array<Record<string, unknown>> {
  const groups = new Map<string, {
    count: number;
    pattern: string;
    sampleSelector: string;
    sourceFile?: string;
    fields: Record<string, unknown>;
  }>();

  for (const item of items) {
    const pattern = normalizeSelectorPattern(item.selector);
    const key = signatureFn(item, pattern);
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (!existing.sourceFile && item.sourceFile) {
        existing.sourceFile = item.sourceFile;
      }
    } else {
      groups.set(key, {
        count: 1,
        pattern,
        sampleSelector: item.selector,
        ...(item.sourceFile ? { sourceFile: item.sourceFile } : {}),
        fields: sampleMapper(item)
      });
    }
  }

  return Array.from(groups.values()).map(g =>
    g.count === 1
      ? {
          selector: g.sampleSelector,
          ...(g.sourceFile ? { sourceFile: g.sourceFile } : {}),
          ...g.fields
        }
      : {
          count: g.count,
          pattern: g.pattern,
          sampleSelector: g.sampleSelector,
          ...(g.sourceFile ? { sourceFile: g.sourceFile } : {}),
          ...g.fields
        }
  );
}

export function compactTouchTargetIssues(items: TouchTargetIssueItem[]): Array<Record<string, unknown>> {
  return groupBySignature(
    items,
    (item, pattern) => `${pattern}|${item.tag}|${item.width}x${item.height}`,
    item => ({
      tag: item.tag,
      size: `${item.width}x${item.height}`,
      minRequired: item.minRequired
    })
  );
}

function compactLayoutForensics(layout: LayoutForensicsReport): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (layout.coverage) {
    out.coverage = {
      scope: layout.coverage.scope,
      ...(layout.coverage.rootSelector ? { rootSelector: layout.coverage.rootSelector } : {}),
      candidateElements: layout.coverage.candidateElements,
      visitedElements: layout.coverage.visitedElements,
      ...(layout.coverage.skippedHiddenElements ? { skippedHiddenElements: layout.coverage.skippedHiddenElements } : {}),
      ...(layout.coverage.skippedRepetitiveElements ? { skippedRepetitiveElements: layout.coverage.skippedRepetitiveElements } : {}),
      elementLimitReached: layout.coverage.elementLimitReached,
      ...(layout.coverage.categoriesAtLimit.length > 0 ? { categoriesAtLimit: layout.coverage.categoriesAtLimit } : {})
    };
  }

  out.horizontalOverflow = {
    hasOverflow: layout.horizontalOverflow.hasOverflow,
    scrollWidth: layout.horizontalOverflow.scrollWidth,
    clientWidth: layout.horizontalOverflow.clientWidth,
    culprits: groupBySignature(
      layout.horizontalOverflow.culprits,
      (item, pattern) => `${pattern}|${item.overflowPx}|${item.reason}`,
      item => ({ overflowPx: item.overflowPx, reason: item.reason, rect: item.rect })
    )
  };

  if (layout.clippingTraps && layout.clippingTraps.length > 0) {
    out.clippingTraps = groupBySignature(
      layout.clippingTraps,
      (item, pattern) => `${pattern}|${item.issue}|${item.ancestorOverflow ?? ''}`,
      item => ({
        issue: item.issue,
        ...(item.ancestorSelector ? { ancestorSelector: item.ancestorSelector } : {}),
        ...(item.ancestorOverflow ? { ancestorOverflow: item.ancestorOverflow } : {})
      })
    );
  }
  if (layout.internalHorizontalScroll && layout.internalHorizontalScroll.length > 0) {
    out.internalHorizontalScroll = groupBySignature(
      layout.internalHorizontalScroll,
      (item, pattern) => `${pattern}|${item.overflowPx}|${item.hasTable}`,
      item => ({
        scrollWidth: item.scrollWidth,
        clientWidth: item.clientWidth,
        overflowPx: item.overflowPx,
        hasTable: item.hasTable
      })
    );
  }
  if (layout.clippedInViewport && layout.clippedInViewport.length > 0) {
    out.clippedInViewport = groupBySignature(
      layout.clippedInViewport,
      (item, pattern) => `${pattern}|${item.tag}|${item.edge}|${item.clippedBy}`,
      item => ({
        tag: item.tag,
        edge: item.edge,
        clippedPx: item.clippedPx,
        clippedBy: item.clippedBy,
        ...(item.ancestorSelector ? { ancestorSelector: item.ancestorSelector } : {})
      })
    );
  }
  if (layout.stackingTraps && layout.stackingTraps.length > 0) {
    out.stackingTraps = groupBySignature(
      layout.stackingTraps,
      (item, pattern) => `${pattern}|${item.zIndex}|${item.trappedInAncestor}`,
      item => ({
        zIndex: item.zIndex,
        trappedInAncestor: item.trappedInAncestor,
        ancestorContextReason: item.ancestorContextReason
      })
    );
  }
  if (layout.brokenMedia && layout.brokenMedia.length > 0) {
    out.brokenMedia = groupBySignature(
      layout.brokenMedia,
      (item, pattern) => `${pattern}|${item.tag}|${item.reason}`,
      item => ({
        tag: item.tag,
        ...(item.srcPath ? { srcPath: item.srcPath } : {}),
        reason: item.reason,
        ...(item.renderSize ? { renderSize: item.renderSize } : {})
      })
    );
  }
  if (layout.fontIssues && layout.fontIssues.length > 0) {
    out.fontIssues = layout.fontIssues;
  }
  if (layout.inactiveCss && layout.inactiveCss.length > 0) {
    out.inactiveCss = groupBySignature(
      layout.inactiveCss,
      (item, pattern) => `${pattern}|${item.property}|${item.value}`,
      item => ({ property: item.property, value: item.value, reason: item.reason })
    );
  }

  return out;
}

function compactAccessibility(a11y: AccessibilityForensicsReport): Record<string, unknown> {
  const out: Record<string, unknown> = {
    coverage: {
      scannedElements: a11y.coverage.scannedElements,
      ...(a11y.coverage.skippedRepetitiveElements ? { skippedRepetitiveElements: a11y.coverage.skippedRepetitiveElements } : {}),
      unverifiableContrastCount: a11y.coverage.unverifiableContrastCount,
      touchTargetsChecked: a11y.coverage.touchTargetsChecked
    }
  };

  if (a11y.contrastIssues.length > 0) {
    out.contrastIssues = groupBySignature(
      a11y.contrastIssues,
      (item, pattern) => `${pattern}|${item.color}|${item.backgroundColor}|${item.ratio}|${item.requiredRatio}`,
      item => ({
        textSample: item.textSample,
        color: item.color,
        backgroundColor: item.backgroundColor,
        ratio: item.ratio,
        requiredRatio: item.requiredRatio,
        fontSize: item.fontSize
      })
    );
  }
  if (a11y.touchTargetIssues.length > 0) {
    out.touchTargetIssues = compactTouchTargetIssues(a11y.touchTargetIssues);
  }
  if (a11y.missingNames.length > 0) {
    out.missingNames = groupBySignature(
      a11y.missingNames,
      (item, pattern) => `${pattern}|${item.tag}|${item.role ?? ''}|${item.reason}`,
      item => ({
        tag: item.tag,
        ...(item.role ? { role: item.role } : {}),
        reason: item.reason
      })
    );
  }
  if (a11y.headingIssues.length > 0) {
    out.headingIssues = a11y.headingIssues;
  }

  return out;
}

function compactBreakpointAudit(item: BreakpointAuditItem): Record<string, unknown> {
  return {
    breakpoint: item.breakpoint,
    width: item.width,
    height: item.height,
    hasHorizontalOverflow: item.hasHorizontalOverflow,
    overflowCulpritsCount: item.overflowCulpritsCount,
    ...(item.topCulprit ? { topCulprit: item.topCulprit } : {}),
    ...(item.internalHorizontalScrollCount ? { internalHorizontalScrollCount: item.internalHorizontalScrollCount } : {}),
    ...(item.clippedInViewportCount ? { clippedInViewportCount: item.clippedInViewportCount } : {}),
    ...(item.touchTargetIssuesCount !== undefined ? { touchTargetIssuesCount: item.touchTargetIssuesCount } : {}),
    ...(item.touchTargetIssues && item.touchTargetIssues.length > 0
      ? { touchTargetIssues: compactTouchTargetIssues(item.touchTargetIssues) }
      : {}),
    ...(item.targetLayout ? { targetLayout: item.targetLayout } : {}),
    ...(item.coverage?.elementLimitReached ? { elementLimitReached: true, visitedElements: item.coverage.visitedElements } : {})
  };
}

export function compactDiagnoseReport(report: DiagnoseReport): Record<string, unknown> {
  return {
    detail: 'compact',
    url: report.url,
    viewport: report.viewport,
    runtimeHealth: report.runtimeHealth,
    layoutForensics: compactLayoutForensics(report.layoutForensics),
    ...(report.accessibility ? { accessibility: compactAccessibility(report.accessibility) } : {}),
    ...(report.designTokens ? { designTokens: report.designTokens } : {}),
    ...(report.cssCascade ? { cssCascade: report.cssCascade } : {}),
    ...(report.breakpointAudits ? { breakpointAudits: report.breakpointAudits.map(compactBreakpointAudit) } : {}),
    ...(report.delta ? { delta: report.delta } : {})
  };
}
