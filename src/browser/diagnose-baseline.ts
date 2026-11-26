import type { DiagnoseDelta, DiagnoseReport, DiagnoseSummaryCounts } from '../types.js';

interface BaselineEntry {
  counts: DiagnoseSummaryCounts;
  capturedAt: string;
}

const MAX_BASELINE_ENTRIES = 50;

export function summarizeDiagnoseReport(report: DiagnoseReport): DiagnoseSummaryCounts {
  return {
    visitedElements: report.layoutForensics.coverage?.visitedElements ?? 0,
    horizontalOverflowCulprits: report.layoutForensics.horizontalOverflow?.culprits?.length ?? 0,
    clippingTraps: report.layoutForensics.clippingTraps?.length ?? 0,
    internalHorizontalScroll: report.layoutForensics.internalHorizontalScroll?.length ?? 0,
    clippedInViewport: report.layoutForensics.clippedInViewport?.length ?? 0,
    stackingTraps: report.layoutForensics.stackingTraps?.length ?? 0,
    brokenMedia: report.layoutForensics.brokenMedia?.length ?? 0,
    fontIssues: report.layoutForensics.fontIssues?.length ?? 0,
    inactiveCss: report.layoutForensics.inactiveCss?.length ?? 0,
    contrastIssues: report.accessibility?.contrastIssues?.length ?? 0,
    touchTargetIssues: report.accessibility?.touchTargetIssues?.length ?? 0,
    missingNames: report.accessibility?.missingNames?.length ?? 0,
    headingIssues: report.accessibility?.headingIssues?.length ?? 0,
    consoleErrors: report.runtimeHealth.consoleErrors?.length ?? 0,
    failedNetwork: report.runtimeHealth.failedNetwork?.length ?? 0
  };
}

export function computeDiagnoseDelta(
  previous: BaselineEntry,
  current: DiagnoseSummaryCounts
): DiagnoseDelta {
  const changes: Record<string, { before: number; after: number; diff: number }> = {};
  for (const key of Object.keys(current) as Array<keyof DiagnoseSummaryCounts>) {
    const before = previous.counts[key];
    const after = current[key];
    if (before !== after) {
      changes[key] = { before, after, diff: after - before };
    }
  }
  return {
    previousCapturedAt: previous.capturedAt,
    changed: Object.keys(changes).length > 0,
    changes
  };
}

export class DiagnoseBaselineStore {
  private entries = new Map<string, BaselineEntry>();

  public static buildKey(parts: {
    targetId: string;
    url: string;
    rootSelector?: string;
    viewportKey?: string;
  }): string {
    return [parts.targetId, parts.url, parts.rootSelector ?? '', parts.viewportKey ?? ''].join('|');
  }

  public diffAgainstPrevious(key: string, current: DiagnoseSummaryCounts): DiagnoseDelta | undefined {
    const previous = this.entries.get(key);
    if (!previous) return undefined;
    return computeDiagnoseDelta(previous, current);
  }

  public record(key: string, counts: DiagnoseSummaryCounts, capturedAt: string): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, { counts, capturedAt });
    if (this.entries.size > MAX_BASELINE_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
  }

  public clear(): void {
    this.entries.clear();
  }
}
