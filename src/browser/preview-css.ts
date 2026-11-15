import type { Page } from 'playwright-core';
import { SpectorError } from '../utils/mcp-response.js';

export const PREVIEW_STYLE_ID = 'spector-live-preview';

export type PreviewAction = 'apply' | 'append' | 'clear' | 'get';

export interface PreviewEvalResult {
  removed?: boolean;
  active?: boolean;
  css: string;
}

export async function applyPreviewCss(page: Page, action: PreviewAction, css?: string): Promise<PreviewEvalResult> {
  if ((action === 'apply' || action === 'append') && !css) {
    throw new SpectorError('INVALID_TOOL_INPUT', `Parameter "css" is required when action is "${action}".`);
  }

  return await page.evaluate(
    ({ id, act, rules }): PreviewEvalResult => {
      let el = document.getElementById(id) as HTMLStyleElement | null;
      if (act === 'clear') {
        if (el) el.remove();
        return { removed: Boolean(el), css: '' };
      }
      if (act === 'get') {
        return { active: Boolean(el), css: el?.textContent || '' };
      }
      if (!el) {
        el = document.createElement('style');
        el.id = id;
        el.setAttribute('data-spector-preview', 'true');
        (document.head || document.documentElement).appendChild(el);
      }
      el.textContent = act === 'append' && el.textContent ? `${el.textContent}\n${rules}` : rules;
      return { active: true, css: el.textContent || '' };
    },
    { id: PREVIEW_STYLE_ID, act: action, rules: css ?? '' }
  );
}
