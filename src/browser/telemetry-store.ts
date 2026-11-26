import type { ConsoleLogEntry, NetworkLogEntry } from '../types.js';
import { TELEMETRY_LIMITS, TOKEN_BUDGETS } from '../constants.js';

const INLINE_SECRET_SEGMENT_RE =
  /((?:password|passwd|access[_-]?token|refresh[_-]?token|token|secret|api[_-]?key|private[_-]?key|authorization|auth|bearer|credentials|credit[_-]?card|cvv)[=:/])[^/&#?\s]+/gi;

export function sanitizeNetworkPathname(rawUrl: string): string {
  if (!rawUrl) return '/';

  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname || '/';
  } catch {
    pathname = rawUrl.split('?')[0].split('#')[0] || '/';
  }

  // Redact inline secrets before truncation so partial tokens cannot leak across bounds.
  const redacted = pathname.replace(INLINE_SECRET_SEGMENT_RE, '$1[REDACTED]');
  if (redacted.length > TOKEN_BUDGETS.MAX_PATHNAME_LEN) {
    return redacted.slice(0, TOKEN_BUDGETS.MAX_PATHNAME_LEN - 3) + '...';
  }
  return redacted;
}

export function sanitizeConsoleLocation(rawLocation?: string): string | undefined {
  if (!rawLocation) return undefined;
  const match = rawLocation.match(/^(.*):(\d+)$/);
  const urlPart = match ? match[1] : rawLocation;
  const lineSuffix = match ? `:${match[2]}` : '';

  try {
    const parsed = new URL(urlPart);
    return `${parsed.origin}${parsed.pathname}${lineSuffix}`;
  } catch {
    return `${urlPart.split('?')[0].split('#')[0]}${lineSuffix}`;
  }
}

export class TelemetryStore {
  private consoleLogs: ConsoleLogEntry[] = [];
  private failedNetworkLogs: NetworkLogEntry[] = [];
  private networkLogSequence = 0;

  private appendConsoleEntry(
    type: string,
    text: string,
    location?: string,
    targetId?: string,
    documentId?: string,
    pageUrl?: string
  ): void {
    const cleanLocation = sanitizeConsoleLocation(location);
    const last = this.consoleLogs[this.consoleLogs.length - 1];
    const truncated = text.length > TELEMETRY_LIMITS.MAX_CONSOLE_TEXT_CHARS;
    if (
      last &&
      !last.textTruncated &&
      !truncated &&
      last.type === type &&
      last.text === text &&
      last.location === cleanLocation &&
      last.targetId === targetId &&
      last.documentId === documentId
    ) {
      last.count = (last.count || 1) + 1;
      last.timestamp = new Date().toISOString();
      return;
    }

    this.consoleLogs.push({
      type,
      text: truncated ? text.slice(0, TELEMETRY_LIMITS.MAX_CONSOLE_TEXT_CHARS - 3) + '...' : text,
      ...(truncated ? { textTruncated: true, originalTextLength: text.length } : {}),
      timestamp: new Date().toISOString(),
      ...(cleanLocation ? { location: cleanLocation } : {}),
      ...(targetId ? { targetId } : {}),
      ...(documentId ? { documentId } : {}),
      ...(pageUrl ? { pageUrl } : {}),
      count: 1
    });

    if (this.consoleLogs.length > TELEMETRY_LIMITS.MAX_LOG_BUFFER) {
      this.consoleLogs.shift();
    }
  }

  public addConsole(
    type: string,
    text: string,
    location?: string,
    targetId?: string,
    documentId?: string,
    pageUrl?: string
  ): void {
    this.appendConsoleEntry(type, text, location, targetId, documentId, pageUrl);
  }

  public addPageError(
    message: string,
    stack?: string,
    targetId?: string,
    documentId?: string,
    pageUrl?: string
  ): void {
    const text = `Uncaught Exception: ${message}${stack ? `\n${stack}` : ''}`;
    this.appendConsoleEntry('error', text, undefined, targetId, documentId, pageUrl);
  }

  /**
   * Records only failed network requests (>=400 or requestfailed) with query strings and bodies discarded.
   */
  public addFailedNetwork(input: {
    method: string;
    url: string;
    resourceType: string;
    status?: number;
    statusText?: string;
    durationMs?: number;
    error?: string;
    targetId?: string;
    documentId?: string;
    pageUrl?: string;
  }): NetworkLogEntry | null {
    const isFailure = input.error !== undefined || (input.status !== undefined && input.status >= 400);
    if (!isFailure) return null;

    const entry: NetworkLogEntry = {
      id: `net-${++this.networkLogSequence}`,
      method: input.method,
      pathname: sanitizeNetworkPathname(input.url),
      resourceType: input.resourceType,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.statusText ? { statusText: input.statusText } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      timestamp: new Date().toISOString(),
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.documentId ? { documentId: input.documentId } : {}),
      ...(input.pageUrl ? { pageUrl: input.pageUrl } : {}),
      ...(input.error ? { error: input.error } : {})
    };

    this.failedNetworkLogs.push(entry);
    if (this.failedNetworkLogs.length > TELEMETRY_LIMITS.MAX_LOG_BUFFER) {
      this.failedNetworkLogs.shift();
    }
    return entry;
  }

  public getConsoleLogs(
    level: 'all' | 'error' | 'warn' = 'error',
    clearAfterRead: boolean = true,
    limit: number = TELEMETRY_LIMITS.CONSOLE_LOG_DEFAULT_LIMIT,
    targetId?: string,
    documentId?: string
  ): ConsoleLogEntry[] {
    let result = [...this.consoleLogs];
    if (targetId) {
      result = result.filter(log => log.targetId === targetId);
    }
    if (documentId) {
      result = result.filter(log => log.documentId === documentId);
    }
    if (level === 'error') {
      result = result.filter(log => log.type === 'error');
    } else if (level === 'warn') {
      result = result.filter(log => log.type === 'error' || log.type === 'warning');
    }

    if (limit > 0 && result.length > limit) {
      result = result.slice(result.length - limit);
    }

    if (clearAfterRead) {
      const returnedSet = new Set(result);
      this.consoleLogs = this.consoleLogs.filter(log => !returnedSet.has(log));
    }
    return result;
  }

  public getFailedNetworkLogs(
    clearAfterRead: boolean = true,
    limit: number = TELEMETRY_LIMITS.NETWORK_LOG_DEFAULT_LIMIT,
    pathnameFilter?: string,
    targetId?: string,
    documentId?: string
  ): NetworkLogEntry[] {
    let result = [...this.failedNetworkLogs];
    if (targetId) {
      result = result.filter(log => log.targetId === targetId);
    }
    if (documentId) {
      result = result.filter(log => log.documentId === documentId);
    }

    if (pathnameFilter) {
      const needle = pathnameFilter.toLowerCase();
      result = result.filter(log => log.pathname.toLowerCase().includes(needle));
    }

    if (limit > 0 && result.length > limit) {
      result = result.slice(result.length - limit);
    }

    if (clearAfterRead) {
      const returnedIds = new Set(result.map(item => item.id));
      this.failedNetworkLogs = this.failedNetworkLogs.filter(log => !returnedIds.has(log.id));
    }
    return result;
  }

  public clearForTarget(targetId: string): void {
    this.consoleLogs = this.consoleLogs.filter(log => log.targetId !== targetId);
    this.failedNetworkLogs = this.failedNetworkLogs.filter(log => log.targetId !== targetId);
  }

  public static formatFailedNetworkLine(entry: NetworkLogEntry): string {
    const status = entry.status !== undefined ? `${entry.status}` : 'FAIL';
    const base = `${entry.method} ${status} ${entry.pathname}`;
    return entry.error ? `${base} (${entry.error})` : base;
  }

  public clear(): void {
    this.consoleLogs = [];
    this.failedNetworkLogs = [];
  }
}
