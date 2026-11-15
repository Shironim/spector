import type { CDPSession, Page } from 'playwright-core';
import { SpectorError } from './mcp-response.js';

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
