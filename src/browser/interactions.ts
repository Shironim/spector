import type { Locator, Page } from 'playwright-core';
import { TIMEOUTS } from '../constants.js';
import { escapeTailwindSelector } from '../utils/selector.js';
import { SpectorError } from '../utils/mcp-response.js';

export type InteractAction = 'click' | 'hover' | 'scroll' | 'scrollIntoView' | 'fill' | 'pressKey' | 'selectOption';

export interface InteractionRequest {
  value?: string;
  action: InteractAction;
  selector?: string;
  scrollDelta?: { x: number; y: number };
  waitForTimeoutMs?: number;
}

interface ResolvedInteractionContext {
  value?: string;
  page: Page;
  selector?: string;
  effectiveSelector?: string;
  scrollDelta?: { x: number; y: number };
  waitForTimeoutMs: number;
  timeoutMs: number;
}

type InteractionHandler = (ctx: ResolvedInteractionContext) => Promise<string>;

async function applyWait(page: Page, ms: number): Promise<void> {
  if (ms > 0) {
    await page.waitForTimeout(ms);
  }
}

async function waitForLocatorState(
  page: Page,
  action: InteractAction,
  selector: string | undefined,
  effectiveSelector: string | undefined,
  state: 'attached' | 'visible',
  timeoutMs: number
): Promise<Locator> {
  if (!selector || !effectiveSelector) {
    throw new SpectorError('INVALID_TOOL_INPUT', `Selector is required for action "${action}".`);
  }
  const locator = page.locator(effectiveSelector).first();
  try {
    await locator.waitFor({ state, timeout: timeoutMs });
    return locator;
  } catch (err) {
    const stateDesc = state === 'attached' ? 'not attached to DOM' : 'not visible';
    throw new SpectorError(
      'ELEMENT_NOT_READY',
      `Cannot perform "${action}": Element "${selector}" ${stateDesc} after ${timeoutMs / 1000}s timeout.`,
      undefined,
      { cause: err }
    );
  }
}

const INTERACTION_HANDLERS: Record<InteractAction, InteractionHandler> = {
  fill: async (ctx) => {
    const locator = await waitForLocatorState(ctx.page, 'fill', ctx.selector, ctx.effectiveSelector, 'visible', ctx.timeoutMs);
    await locator.fill(ctx.value!, { timeout: ctx.timeoutMs });
    await applyWait(ctx.page, ctx.waitForTimeoutMs);
    return 'Filled target input.';
  },
  pressKey: async (ctx) => {
    const locator = await waitForLocatorState(ctx.page, 'pressKey', ctx.selector, ctx.effectiveSelector, 'visible', ctx.timeoutMs);
    await locator.press(ctx.value!, { timeout: ctx.timeoutMs });
    await applyWait(ctx.page, ctx.waitForTimeoutMs);
    return 'Pressed key on target element.';
  },
  selectOption: async (ctx) => {
    const locator = await waitForLocatorState(ctx.page, 'selectOption', ctx.selector, ctx.effectiveSelector, 'visible', ctx.timeoutMs);
    await locator.selectOption(ctx.value!, { timeout: ctx.timeoutMs });
    await applyWait(ctx.page, ctx.waitForTimeoutMs);
    return 'Selected target option.';
  },
  scrollIntoView: async (ctx) => {
    const locator = await waitForLocatorState(ctx.page, 'scrollIntoView', ctx.selector, ctx.effectiveSelector, 'attached', ctx.timeoutMs);
    await locator.evaluate((el: HTMLElement) => {
      el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    });
    await applyWait(ctx.page, ctx.waitForTimeoutMs);
    return `Scrolled element "${ctx.selector}" into view (centered in viewport).`;
  },

  scroll: async (ctx) => {
    const x = ctx.scrollDelta?.x ?? 0;
    const y = ctx.scrollDelta ? (ctx.scrollDelta.y ?? 0) : 300;
    if (ctx.effectiveSelector) {
      const locator = await waitForLocatorState(ctx.page, 'scroll', ctx.selector, ctx.effectiveSelector, 'attached', ctx.timeoutMs);
      await locator.evaluate((el, delta) => el.scrollBy(delta.x, delta.y), { x, y });
      await applyWait(ctx.page, ctx.waitForTimeoutMs);
      return `Scrolled element "${ctx.selector}" by x=${x}, y=${y}.`;
    }
    await ctx.page.evaluate((delta) => window.scrollBy(delta.x, delta.y), { x, y });
    await applyWait(ctx.page, ctx.waitForTimeoutMs);
    return `Scrolled page by x=${x}, y=${y}.`;
  },

  click: async (ctx) => {
    const locator = await waitForLocatorState(ctx.page, 'click', ctx.selector, ctx.effectiveSelector, 'visible', ctx.timeoutMs);
    await locator.click();
    await applyWait(ctx.page, ctx.waitForTimeoutMs);
    return `Clicked element "${ctx.selector}".`;
  },

  hover: async (ctx) => {
    const locator = await waitForLocatorState(ctx.page, 'hover', ctx.selector, ctx.effectiveSelector, 'visible', ctx.timeoutMs);
    await locator.hover();
    await applyWait(ctx.page, ctx.waitForTimeoutMs);
    return `Hovered element "${ctx.selector}".`;
  }
};

export async function dispatchPageInteraction(page: Page, request: InteractionRequest): Promise<string> {
  if (['fill', 'pressKey', 'selectOption'].includes(request.action) && typeof request.value !== 'string') {
    throw new SpectorError('INVALID_TOOL_INPUT', 'A string value is required for this action.');
  }
  const handler = INTERACTION_HANDLERS[request.action];
  if (!handler) {
    throw new SpectorError('INVALID_TOOL_INPUT', `Unsupported action: ${request.action}`);
  }
  const effectiveSelector = request.selector ? escapeTailwindSelector(request.selector) : request.selector;
  return await handler({
    page,
    value: request.value,
    selector: request.selector,
    effectiveSelector,
    scrollDelta: request.scrollDelta,
    waitForTimeoutMs: request.waitForTimeoutMs ?? 0,
    timeoutMs: TIMEOUTS.INTERACT_DEFAULT_MS
  });
}
