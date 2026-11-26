import type { Page } from 'playwright-core';
import type { DesignTokenAuditReport } from '../types.js';
import { evaluateInPage } from '../utils/cdp.js';
import { escapeTailwindSelector } from '../utils/selector.js';
import { SpectorError } from '../utils/mcp-response.js';
import { TOKEN_BUDGETS } from '../constants.js';

export interface TokenAuditOptions {
  rootSelector?: string;
  maxElements?: number;
}

export async function runTokenAudit(
  page: Page,
  options?: TokenAuditOptions
): Promise<DesignTokenAuditReport | undefined> {
  const maxElements = Math.min(
    Math.max(1, Math.floor(options?.maxElements ?? TOKEN_BUDGETS.MAX_TOKEN_SCAN_ELEMENTS)),
    TOKEN_BUDGETS.MAX_DIAGNOSE_MAX_ELEMENTS
  );
  const maxCssVars = TOKEN_BUDGETS.MAX_CSS_VARIABLES;
  const rawRootSelector = options?.rootSelector?.trim() || undefined;
  const escapedRootSelector = rawRootSelector ? escapeTailwindSelector(rawRootSelector) : undefined;

  const script = `(() => {
    const maxElements = ${maxElements};
    const maxCssVars = ${maxCssVars};
    const rawRootSelector = ${JSON.stringify(rawRootSelector ?? null)};
    const escapedRootSelector = ${JSON.stringify(escapedRootSelector ?? null)};

    const styleCache = new WeakMap();
    const getStyle = (el) => {
      let cs = styleCache.get(el);
      if (!cs) {
        cs = window.getComputedStyle(el);
        styleCache.set(el, cs);
      }
      return cs;
    };

    const hiddenCache = new WeakMap();
    const isHiddenOrInHiddenAncestor = (el) => {
      const cached = hiddenCache.get(el);
      if (cached !== undefined) return cached;
      const cs = getStyle(el);
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || cs.contentVisibility === 'hidden') {
        hiddenCache.set(el, true);
        return true;
      }
      const parent = el.parentElement;
      const hidden = parent && parent !== document.documentElement
        ? isHiddenOrInHiddenAncestor(parent)
        : false;
      hiddenCache.set(el, hidden);
      return hidden;
    };

    let rawElements;
    if (escapedRootSelector) {
      const rootEl = document.querySelector(escapedRootSelector);
      if (!rootEl) return { __spectorRootMissing: true };
      rawElements = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))];
    } else {
      rawElements = Array.from(document.querySelectorAll('body *'));
    }

    const inc = (map, val) => {
      if (!val) return;
      map.set(val, (map.get(val) || 0) + 1);
    };

    const toTop = (map, limit) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([value, count]) => ({ value, count }));

    const fontFamilies = new Set();
    const fontSizes = new Map();
    const fontWeights = new Map();
    const backgrounds = new Map();
    const textColors = new Map();
    const borderColors = new Map();
    const radii = new Map();
    const paddings = new Map();
    const gaps = new Map();

    const elements = rawElements.filter(el => !el.closest || !el.closest('[data-spector-activity]'));
    let scannedElements = 0;
    let skippedHiddenElements = 0;
    let limitReached = false;

    const isTransparent = (c) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)' || c === 'rgb(0 0 0 / 0)';

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!(el instanceof HTMLElement)) continue;
      if (isHiddenOrInHiddenAncestor(el)) {
        skippedHiddenElements++;
        continue;
      }
      if (scannedElements >= maxElements) {
        limitReached = true;
        break;
      }
      scannedElements++;
      const cs = getStyle(el);

      if (cs.fontFamily) fontFamilies.add(cs.fontFamily);
      if (cs.fontSize) inc(fontSizes, cs.fontSize);
      if (cs.fontWeight) inc(fontWeights, cs.fontWeight);
      if (!isTransparent(cs.backgroundColor)) inc(backgrounds, cs.backgroundColor);
      if (!isTransparent(cs.color)) inc(textColors, cs.color);
      if (cs.borderTopWidth && cs.borderTopWidth !== '0px' && !isTransparent(cs.borderTopColor)) {
        inc(borderColors, cs.borderTopColor);
      }
      if (cs.borderRadius && cs.borderRadius !== '0px') inc(radii, cs.borderRadius);
      if (cs.padding && cs.padding !== '0px') inc(paddings, cs.padding);
      if (cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') inc(gaps, cs.gap);
    }

    const cssVariables = {};
    let varCount = 0;
    const rootStyle = document.documentElement ? getStyle(document.documentElement) : null;
    if (document.styleSheets && rootStyle) {
      for (const sheet of Array.from(document.styleSheets)) {
        if (varCount >= maxCssVars) break;
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          if (varCount >= maxCssVars) break;
          if (!rule.selectorText || !/:root|\\bhtml\\b/.test(rule.selectorText) || !rule.style) continue;
          for (let j = 0; j < rule.style.length && varCount < maxCssVars; j++) {
            const prop = rule.style[j];
            if (prop && prop.startsWith('--') && !(prop in cssVariables)) {
              const resolved = rootStyle.getPropertyValue(prop).trim();
              if (resolved) {
                cssVariables[prop] = resolved;
                varCount++;
              }
            }
          }
        }
      }
    }

    const slopSignals = [];
    if (radii.size > 5) slopSignals.push('High border-radius fragmentation (' + radii.size + ' unique values)');
    if (fontSizes.size > 8) slopSignals.push('Wide font-size sprawl (' + fontSizes.size + ' unique values)');
    if (fontWeights.size > 4) slopSignals.push('Excessive font-weight variety (' + fontWeights.size + ' unique values)');
    if (backgrounds.size > 12) slopSignals.push('High surface/background color count (' + backgrounds.size + ' unique values)');
    if (fontFamilies.size > 3) slopSignals.push('Too many font families (' + fontFamilies.size + ' unique families)');

    return {
      coverage: {
        scope: rawRootSelector ? 'scoped-light-dom' : 'document-light-dom',
        ...(rawRootSelector ? { rootSelector: rawRootSelector } : {}),
        scannedElements,
        ...(skippedHiddenElements > 0 ? { skippedHiddenElements } : {}),
        limitReached
      },
      typography: {
        uniqueFontFamilies: Array.from(fontFamilies).slice(0, 10),
        fontSizes: toTop(fontSizes, 15),
        fontWeights: toTop(fontWeights, 10)
      },
      colors: {
        backgrounds: toTop(backgrounds, 15),
        textColors: toTop(textColors, 15),
        borderColors: toTop(borderColors, 12)
      },
      radii: toTop(radii, 12),
      spacing: {
        paddings: toTop(paddings, 12),
        gaps: toTop(gaps, 12)
      },
      cssVariables,
      slopSignals
    };
  })()`;

  const result = await evaluateInPage(page, script);
  if (result && typeof result === 'object' && '__spectorRootMissing' in result) {
    throw new SpectorError('ELEMENT_NOT_READY', `Root selector "${rawRootSelector}" not found in active document.`);
  }
  if (!result || typeof result !== 'object' || !(result as DesignTokenAuditReport).typography) {
    return undefined;
  }
  return result as DesignTokenAuditReport;
}
