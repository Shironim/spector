import type { CDPSession, Page } from 'playwright-core';
import { TIMEOUTS } from '../constants.js';
import { SpectorError } from './mcp-response.js';

export interface CdpTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
}

export async function getCdpTargetInfo(page: Page): Promise<CdpTargetInfo | null> {
  if (typeof (page as { context?: unknown }).context !== 'function') return null;
  const ctx = page.context();
  if (!ctx || typeof (ctx as { newCDPSession?: unknown }).newCDPSession !== 'function') return null;
  try {
    return await withCdpSession(page, Math.min(500, TIMEOUTS.CDP_CONNECT_MS), 'Target info', async (cdp) => {
      const res = await cdp.send('Target.getTargetInfo');
      const info = res?.targetInfo;
      if (!info || typeof info.url !== 'string') return null;
      return {
        targetId: info.targetId,
        type: info.type,
        title: info.title,
        url: info.url
      };
    });
  } catch {
    return null;
  }
}

const corruptedMainFramePages = new WeakSet<Page>();

export function setMainFrameCorrupted(page: Page, corrupted: boolean): void {
  if (corrupted) {
    corruptedMainFramePages.add(page);
  } else {
    corruptedMainFramePages.delete(page);
  }
}

export function isMainFrameCorrupted(page: Page): boolean {
  return corruptedMainFramePages.has(page);
}

/**
 * Evaluates a script or function in the page's top-level target.
 * Falls back to direct CDP Runtime.evaluate when Playwright's _mainFrame
 * is empty or hijacked by a cross-origin iframe (OOPIF).
 */
export async function evaluateInPage<R, Arg = undefined>(
  page: Page,
  fn: ((arg: Arg) => R | Promise<R>) | string,
  arg?: Arg
): Promise<R> {
  const pwUrl = typeof (page as { url?: unknown }).url === 'function' ? page.url() : undefined;
  let useCdpFallback = pwUrl === '' || isMainFrameCorrupted(page);
  if (!useCdpFallback && pwUrl !== undefined && isMainFrameCorrupted(page)) {
    const targetInfo = await getCdpTargetInfo(page);
    useCdpFallback = Boolean(targetInfo && (pwUrl === '' || pwUrl !== targetInfo.url));
  }
  if (!useCdpFallback) {
    return arg === undefined
      ? await page.evaluate(fn as () => R | Promise<R>)
      : await page.evaluate(fn as any, arg);
  }

  const expression = typeof fn === 'string'
    ? fn
    : arg === undefined
      ? `(${fn.toString()})()`
      : `(${fn.toString()})(${JSON.stringify(arg)})`;

  return await withCdpSession(page, TIMEOUTS.CDP_CONNECT_MS, 'Page evaluation', async (cdp) => {
    const res = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Runtime.evaluate failed';
      throw new Error(desc);
    }
    return res.result.value as R;
  });
}

export async function withDeadline<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new SpectorError('OPERATION_TIMEOUT', `${operation} timed out after ${ms}ms.`));
        }, ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withCdpSession<T>(
  page: Page,
  timeoutMs: number,
  operation: string,
  fn: (cdp: CDPSession) => Promise<T>
): Promise<T> {
  const cdp = await page.context().newCDPSession(page);
  try {
    return await withDeadline(fn(cdp), timeoutMs, operation);
  } finally {
    await cdp.detach().catch(() => {});
  }
}
