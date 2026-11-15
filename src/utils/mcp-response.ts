import type { McpToolResponse, SpectorErrorCode } from '../types.js';

export class SpectorError extends Error {
  public readonly details?: Record<string, unknown>;
  public readonly code: SpectorErrorCode;
  public readonly recommendation?: string;

  public constructor(
    code: SpectorErrorCode,
    message: string,
    recommendation?: string,
    options?: { cause?: unknown; details?: Record<string, unknown> }
  ) {
    super(message, options);
    this.name = 'SpectorError';
    this.code = code;
    this.recommendation = recommendation;
    this.details = options?.details;
  }
}

interface ErrorCatalogEntry {
  reason: string;
  defaultRecommendation: string;
}

const SPECTOR_ERROR_CATALOG: Record<SpectorErrorCode, ErrorCatalogEntry> = {
  RESOURCE_LIMIT_EXCEEDED: {
    reason: 'The request exceeds a configured resource budget.',
    defaultRecommendation: 'Use a narrower selector, smaller capture area, or fewer breakpoints. Do not automatically repeat side effects.'
  },
  VIEWPORT_RESTORE_FAILED: {
    reason: 'The breakpoint operation could not restore the original viewport. Capture results were not returned as valid.',
    defaultRecommendation: 'Check the selected tab and viewport before continuing. Do not retry a prior interaction automatically.'
  },
  TARGET_CHANGED: {
    reason: 'The selected page closed or the target/URL changed. An action may already have occurred; it was not retried.',
    defaultRecommendation: 'List tabs and explicitly select the intended target, then verify its URL before continuing.'
  },
  CDP_ENDPOINT_DENIED: {
    reason: 'The configured Chrome debugging endpoint is blocked by Spector security policy.',
    defaultRecommendation: 'Use a local Chrome CDP endpoint such as http://localhost:9222.'
  },
  INVALID_CDP_ENDPOINT: {
    reason: 'The configured Chrome debugging endpoint is not a valid URL.',
    defaultRecommendation: 'Set cdpUrl to a valid local Chrome debugging URL, then call spector_attach.'
  },
  BROWSER_CONTEXT_UNAVAILABLE: {
    reason: 'Chrome is connected, but Spector could not find an available browser page.',
    defaultRecommendation: 'Open a Chrome tab, then call spector_attach and spector_tabs({ action: "list" }).'
  },
  CHROME_CDP_UNAVAILABLE: {
    reason: 'Spector could not connect to Chrome through the configured remote debugging endpoint.',
    defaultRecommendation: 'Start Chrome with remote debugging enabled on the configured CDP endpoint, then call spector_attach.'
  },
  BROWSER_NOT_ATTACHED: {
    reason: 'There is no active attached Chrome page for this operation.',
    defaultRecommendation: 'Call spector_attach, then use spector_tabs to list and select an open tab.'
  },
  NO_PICKED_ELEMENT: {
    reason: 'Spector has no cached element selection to return.',
    defaultRecommendation: 'Pick a target with Alt+P in an attached Chrome tab or call spector_picker({ action: "pick" }), then retry.'
  },
  PICKER_CANCELLED: {
    reason: 'Element selection was cancelled before a target was picked.',
    defaultRecommendation: 'Call spector_picker({ action: "pick" }) again and click or drag a target before pressing Escape.'
  },
  ELEMENT_NOT_READY: {
    reason: 'The requested page element could not be found, is detached, or is not visible.',
    defaultRecommendation: 'Check that the CSS selector matches an element in the current page and that the element is attached and visible.'
  },
  TAB_NOT_FOUND: {
    reason: 'No open tab matched the requested selection criteria.',
    defaultRecommendation: 'Call spector_tabs({ action: "list" }) and retry with an index, title, or URL that matches an open tab.'
  },
  OPERATION_TIMEOUT: {
    reason: 'The operation did not complete before its timeout.',
    defaultRecommendation: 'Wait for the page or target element to finish loading, then retry; increase the timeout when the operation allows it.'
  },
  INVALID_TOOL_INPUT: {
    reason: 'One or more tool parameters are missing or invalid.',
    defaultRecommendation: 'Check the tool parameters and provide the required values using the documented options.'
  },
  TOOL_OPERATION_FAILED: {
    reason: 'An unexpected error prevented the tool from completing.',
    defaultRecommendation: 'Check the current page and tool parameters, then retry. If the issue persists, reconnect with spector_attach.'
  }
};

// Classifies third-party Playwright/Node errors at the MCP response boundary without leaking raw system messages.
const EXTERNAL_ERROR_MATCHERS: ReadonlyArray<{ pattern: RegExp; code: SpectorErrorCode }> = [
  { pattern: /securitypolicyerror|remote cdp host.*denied/, code: 'CDP_ENDPOINT_DENIED' },
  { pattern: /invalid cdp url/, code: 'INVALID_CDP_ENDPOINT' },
  { pattern: /no active page|no active browser context|no browser contexts/, code: 'BROWSER_CONTEXT_UNAVAILABLE' },
  { pattern: /econnrefused|failed to connect to chrome|remote debugging/, code: 'CHROME_CDP_UNAVAILABLE' },
  { pattern: /chrome browser is not attached|browser is not attached yet/, code: 'BROWSER_NOT_ATTACHED' },
  { pattern: /no element or section has been picked|no pins/, code: 'NO_PICKED_ELEMENT' },
  { pattern: /selector|not visible|not attached to dom|no element/, code: 'ELEMENT_NOT_READY' },
  { pattern: /tab .*not found|out of bounds|no open tabs/, code: 'TAB_NOT_FOUND' },
  { pattern: /timeout|timed out/, code: 'OPERATION_TIMEOUT' },
  { pattern: /required|invalid|unsupported|unknown action/, code: 'INVALID_TOOL_INPUT' }
];

function classifyExternalError(error: unknown): SpectorErrorCode {
  if (error instanceof AggregateError && error.message === 'Breakpoint audit failed to restore the original viewport.') return 'VIEWPORT_RESTORE_FAILED';
  const detail = (error instanceof Error ? error.message : String(error)).toLowerCase();
  for (const matcher of EXTERNAL_ERROR_MATCHERS) {
    if (matcher.pattern.test(detail)) {
      return matcher.code;
    }
  }
  return 'TOOL_OPERATION_FAILED';
}

export function textResponse(text: string, isError = false): McpToolResponse {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {})
  };
}

export function jsonResponse(data: unknown, isError = false): McpToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {})
  };
}

export function envelopeResponse(success: boolean, message: string, data?: unknown, isError = false): McpToolResponse {
  const payload: Record<string, unknown> = {
    success,
    message
  };
  if (data !== undefined) {
    payload.data = data;
  }
  return jsonResponse(payload, isError);
}

export function failSafeResponse(toolName: string, error: unknown, recommendation?: string): McpToolResponse {
  const code = error instanceof SpectorError ? error.code : classifyExternalError(error);
  const entry = SPECTOR_ERROR_CATALOG[code];
  const resolvedRecommendation =
    recommendation ?? (error instanceof SpectorError ? error.recommendation : undefined) ?? entry.defaultRecommendation;

  return envelopeResponse(
    false,
    `${toolName} failed: ${entry.reason}`,
    {
      code,
      reason: entry.reason,
      recommendation: resolvedRecommendation,
      ...(error instanceof SpectorError && error.details ? error.details : {})
    },
    true
  );
}
