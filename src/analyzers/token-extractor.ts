import type { Page } from 'playwright-core';
import type { DesignTokensResult } from '../types.js';
import { TOKEN_BUDGETS } from '../constants.js';
import { buildTokenMap } from './token-mapper.js';

export interface TokenExtractOptions {
  includeVariables?: boolean;
  maxPaletteItems?: number;
}

export async function extractDesignTokens(
  page: Page,
  options: TokenExtractOptions = {}
): Promise<DesignTokensResult> {
  const { includeVariables = true, maxPaletteItems = 8 } = options;

  const raw = await page.evaluate(
    ({ withVars, paletteCap, maxVars, maxScan }) => {
      const cssVariables: Record<string, string> = {};
      if (withVars) {
        const rootStyle = window.getComputedStyle(document.documentElement);
        let count = 0;
        for (let i = 0; i < rootStyle.length && count < maxVars; i++) {
          const prop = rootStyle[i];
          if (!prop.startsWith('--') || prop.startsWith('--tw-')) continue;
          const value = rootStyle.getPropertyValue(prop).trim();
          if (!value) continue;
          cssVariables[prop] = value;
          count++;
        }
      }

      const bump = (map: Map<string, number>, val: string) => {
        if (!val) return;
        map.set(val, (map.get(val) || 0) + 1);
      };

      const topKeys = (map: Map<string, number>, limit: number): string[] =>
        Array.from(map.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([k]) => k);

      const bgMap = new Map<string, number>();
      const surfaceMap = new Map<string, number>();
      const textColorMap = new Map<string, number>();
      const accentMap = new Map<string, number>();
      const borderMap = new Map<string, number>();
      const fontFamilyMap = new Map<string, number>();
      const radiiMap = new Map<string, number>();
      const shadowMap = new Map<string, number>();
      const containerWidthMap = new Map<string, number>();
      const typoScaleMap = new Map<
        string,
        { fontSize: string; fontWeight: string; lineHeight: string; tags: Set<string>; count: number }
      >();

      const bodyCs = window.getComputedStyle(document.body);
      if (bodyCs.backgroundColor && bodyCs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        bump(bgMap, bodyCs.backgroundColor);
      }

      const allElements = Array.from(document.querySelectorAll('body *')).filter(el => !el.closest('[data-spector-activity]'));
      const scanLimit = Math.min(allElements.length, maxScan);

      const hasDirectText = (el: Element): boolean => {
        for (let i = 0; i < el.childNodes.length; i++) {
          const n = el.childNodes[i];
          if (n.nodeType === 3 && n.textContent && n.textContent.trim()) return true;
        }
        return false;
      };

      for (let i = 0; i < scanLimit; i++) {
        const el = allElements[i];
        if (!(el instanceof HTMLElement)) continue;
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;

        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        const tag = el.tagName.toLowerCase();
        const isSection = ['header', 'main', 'section', 'footer', 'nav', 'aside'].includes(tag);
        const isInteractive = tag === 'a' || tag === 'button' || el.getAttribute('role') === 'button';

        if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
          if (isSection && rect.width > window.innerWidth * 0.6) {
            bump(bgMap, cs.backgroundColor);
          } else if (isInteractive) {
            bump(accentMap, cs.backgroundColor);
          } else {
            bump(surfaceMap, cs.backgroundColor);
          }
        }

        if (cs.borderTopWidth !== '0px' && cs.borderTopColor && cs.borderTopColor !== 'rgba(0, 0, 0, 0)') {
          bump(borderMap, cs.borderTopColor);
        }

        if (cs.borderRadius && cs.borderRadius !== '0px') {
          bump(radiiMap, cs.borderRadius);
        }

        if (cs.boxShadow && cs.boxShadow !== 'none') {
          bump(shadowMap, cs.boxShadow);
        }

        if (cs.maxWidth && cs.maxWidth !== 'none' && cs.maxWidth !== '100%' && cs.maxWidth !== '0px') {
          bump(containerWidthMap, cs.maxWidth);
        }

        if (hasDirectText(el)) {
          bump(textColorMap, cs.color);
          bump(fontFamilyMap, cs.fontFamily);
          const typoKey = `${cs.fontSize}|${cs.fontWeight}|${cs.lineHeight}`;
          const existing = typoScaleMap.get(typoKey);
          if (existing) {
            existing.count++;
            if (existing.tags.size < 4) existing.tags.add(tag);
          } else {
            typoScaleMap.set(typoKey, {
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              lineHeight: cs.lineHeight,
              tags: new Set([tag]),
              count: 1
            });
          }
          if (isInteractive && cs.color) {
            bump(accentMap, cs.color);
          }
        }
      }

      const scale = Array.from(typoScaleMap.values())
        .sort((a, b) => parseFloat(b.fontSize) - parseFloat(a.fontSize))
        .slice(0, 12)
        .map((item) => ({
          fontSize: item.fontSize,
          fontWeight: item.fontWeight,
          lineHeight: item.lineHeight,
          sampleTags: Array.from(item.tags),
          count: item.count
        }));

      return {
        url: window.location.href,
        coverage: {
          scope: 'document-light-dom' as const, candidateElements: allElements.length, visitedElements: scanLimit,
          elementLimitReached: allElements.length > scanLimit,
          variablesAtLimit: withVars && Object.keys(cssVariables).length >= maxVars, variablesRequested: withVars,
          excluded: ['iframe-documents', 'shadow-roots', 'hidden-or-zero-area-elements', 'tailwind-internal-variables']
        },
        cssVariables,
        palette: {
          backgrounds: topKeys(bgMap, paletteCap),
          surfaces: topKeys(surfaceMap, paletteCap),
          texts: topKeys(textColorMap, paletteCap),
          accents: topKeys(accentMap, paletteCap),
          borders: topKeys(borderMap, paletteCap)
        },
        typography: {
          fontFamilies: topKeys(fontFamilyMap, 6),
          scale
        },
        radii: topKeys(radiiMap, 10),
        shadows: topKeys(shadowMap, 8),
        containerWidths: topKeys(containerWidthMap, 8)
      };
    },
    {
      withVars: includeVariables,
      paletteCap: maxPaletteItems,
      maxVars: TOKEN_BUDGETS.MAX_CSS_VARIABLES,
      maxScan: TOKEN_BUDGETS.MAX_TOKEN_SCAN_ELEMENTS
    }
  );

  const tokenMap = buildTokenMap(raw);
  return tokenMap ? { ...raw, tokenMap } : raw;
}
