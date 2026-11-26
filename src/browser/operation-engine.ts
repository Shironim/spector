import { AsyncLocalStorage } from 'node:async_hooks';
import type { Frame, Page } from 'playwright-core';
import { TIMEOUTS, TOKEN_BUDGETS } from '../constants.js';
import { SpectorError } from '../utils/mcp-response.js';

interface OperationContext { page: Page; active: boolean; controller: AbortController; deadline: number }

export class BrowserOperationEngine {
  private tails = new WeakMap<Page, Promise<unknown>>();
  private pending = new WeakMap<Page, number>();
  private context = new AsyncLocalStorage<OperationContext>();

  public constructor(
    private readonly validate: (page: Page, url: string, navigated: boolean) => void,
    private readonly readUrl: (page: Page) => string = page => page.url()
  ) {}

  public get currentPage(): Page | undefined {
    this.throwIfExpired();
    const context = this.context.getStore();
    return context?.active ? context.page : undefined;
  }

  public throwIfExpired(): void {
    const context = this.context.getStore();
    if (!context?.active) return;
    if (!context.controller.signal.aborted && performance.now() >= context.deadline) {
      context.controller.abort(new SpectorError('OPERATION_TIMEOUT', 'Browser operation deadline exceeded.',
        'Work may still be settling. Do not retry side effects automatically.', { details: { operationMayContinue: true } }));
    }
    if (context.controller.signal.aborted) throw context.controller.signal.reason;
  }

  public remainingTime(localLimit: number): number {
    this.throwIfExpired();
    const context = this.context.getStore();
    return context?.active ? Math.max(1, Math.min(localLimit, context.deadline - performance.now())) : localLimit;
  }

  public async run<T>(page: Page, operation: () => Promise<T>, options: { allowNavigation?: boolean; timeoutMs?: number } = {}): Promise<T> {
    if (this.currentPage === page) return operation();
    const timeoutMs = options.timeoutMs ?? TIMEOUTS.OPERATION_DEFAULT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new SpectorError('INVALID_TOOL_INPUT', 'Operation deadline must be finite and positive.');
    const pending = this.pending.get(page) ?? 0;
    if (pending >= TOKEN_BUDGETS.MAX_PENDING_OPERATIONS) {
      throw new SpectorError('RESOURCE_LIMIT_EXCEEDED', 'Page operation queue is full.',
        'Wait for pending work to settle; a previous operation may still be running.');
    }
    this.pending.set(page, pending + 1);
    const controller = new AbortController();
    const deadline = performance.now() + timeoutMs;
    let started = false;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new SpectorError('OPERATION_TIMEOUT', 'Browser operation deadline exceeded.',
          'Work may still be settling. Do not retry side effects automatically.', { details: { operationMayContinue: started } });
        controller.abort(error); reject(error);
        if (!started) page.off('framenavigated', onNavigation);
      }, timeoutMs);
    });
    const url = this.readUrl(page);
    let navigated = false;
    const onNavigation = (frame: Frame) => { if (frame === page.mainFrame()) navigated = true; };
    page.on('framenavigated', onNavigation);
    const execute = async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      this.validate(page, url, navigated);
      started = true;
      const context = { page, active: true, controller, deadline };
      try {
        return await this.context.run(context, async () => {
          const result = await operation();
          this.throwIfExpired();
          this.validate(page, options.allowNavigation ? this.readUrl(page) : url, !options.allowNavigation && navigated);
          return result;
        });
      } finally { context.active = false; }
    };
    const previous = this.tails.get(page) ?? Promise.resolve();
    const completion = previous.then(execute, execute).finally(() => {
      clearTimeout(timer);
      const count = (this.pending.get(page) ?? 1) - 1;
      if (count === 0) this.pending.delete(page); else this.pending.set(page, count);
      page.off('framenavigated', onNavigation);
      if (this.tails.get(page) === tail) this.tails.delete(page);
    });
    const tail = completion.catch(() => {});
    this.tails.set(page, tail);
    // The caller deadline does not release browser ownership; completion owns cleanup.
    return await Promise.race([completion, timeout]);
  }
}
