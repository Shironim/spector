import type { Page } from 'playwright-core';
import type { AccessibilityForensicsReport } from '../types.js';
import { evaluateInPage } from '../utils/cdp.js';
import { escapeTailwindSelector, IN_BROWSER_CSS_SELECTOR_FN } from '../utils/selector.js';
import { SpectorError } from '../utils/mcp-response.js';
import { TOKEN_BUDGETS } from '../constants.js';

export interface AccessibilityForensicsOptions {
  rootSelector?: string;
  maxElements?: number;
  checkTouchTargets?: boolean;
}

export async function runAccessibilityForensics(
  page: Page,
  options?: AccessibilityForensicsOptions
): Promise<AccessibilityForensicsReport | undefined> {
  const maxIssues = TOKEN_BUDGETS.MAX_DIAGNOSE_ISSUES;
  const maxElements = Math.min(
    Math.max(1, Math.floor(options?.maxElements ?? TOKEN_BUDGETS.MAX_TOKEN_SCAN_ELEMENTS)),
    TOKEN_BUDGETS.MAX_DIAGNOSE_MAX_ELEMENTS
  );
  const rawRootSelector = options?.rootSelector?.trim() || undefined;
  const escapedRootSelector = rawRootSelector ? escapeTailwindSelector(rawRootSelector) : undefined;
  const forceTouchTargets = options?.checkTouchTargets;

  const script = `(() => {
    const maxIssues = ${maxIssues};
    const maxElements = ${maxElements};
    const rawRootSelector = ${JSON.stringify(rawRootSelector ?? null)};
    const escapedRootSelector = ${JSON.stringify(escapedRootSelector ?? null)};
    const forceTouchTargets = ${JSON.stringify(forceTouchTargets ?? null)};
    ${IN_BROWSER_CSS_SELECTOR_FN}

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

    const parseRgba = (str) => {
      if (!str) return null;
      const s = String(str).trim().toLowerCase();
      if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
      // Match both rgb(r, g, b), rgba(r, g, b, a), and CSS Color 4 rgb(r g b / a)
      const m = s.match(/^rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+%?))?\\s*\\)$/);
      if (!m) return null;
      const r = Math.min(255, Math.max(0, Number(m[1])));
      const g = Math.min(255, Math.max(0, Number(m[2])));
      const b = Math.min(255, Math.max(0, Number(m[3])));
      let a = 1;
      if (m[4] !== undefined) {
        a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      }
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) return null;
      return { r, g, b, a: Math.min(1, Math.max(0, a)) };
    };

    const blendOver = (fg, bg) => {
      const a = fg.a;
      return {
        r: fg.r * a + bg.r * (1 - a),
        g: fg.g * a + bg.g * (1 - a),
        b: fg.b * a + bg.b * (1 - a),
        a: 1
      };
    };

    const relativeLuminance = ({ r, g, b }) => {
      const toLinear = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    };

    const contrastRatio = (c1, c2) => {
      const l1 = relativeLuminance(c1);
      const l2 = relativeLuminance(c2);
      const hi = Math.max(l1, l2);
      const lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    };

    const resolveEffectiveBackground = (el) => {
      const layers = [];
      let cur = el;
      while (cur && cur.nodeType === 1) {
        const cs = getStyle(cur);
        if (!cs) break;
        if (cs.opacity && parseFloat(cs.opacity) < 1) {
          return { unverifiable: true };
        }
        if (cs.backgroundImage && cs.backgroundImage !== 'none') {
          return { unverifiable: true };
        }
        const bg = parseRgba(cs.backgroundColor);
        if (cs.backgroundColor && !bg) {
          return { unverifiable: true };
        }
        if (bg && bg.a > 0) {
          layers.push(bg);
          if (bg.a >= 0.999) break;
        }
        cur = cur.parentElement;
      }
      // Composite from bottom (white canvas fallback) up to element
      let acc = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) {
        acc = blendOver(layers[i], acc);
      }
      return { color: acc, css: 'rgb(' + Math.round(acc.r) + ', ' + Math.round(acc.g) + ', ' + Math.round(acc.b) + ')' };
    };

    const getDirectTextSample = (el) => {
      if (!el.childNodes) return '';
      let txt = '';
      for (let i = 0; i < el.childNodes.length; i++) {
        const n = el.childNodes[i];
        if (n && n.nodeType === 3 && n.textContent) {
          const t = n.textContent.trim();
          if (t) txt += (txt ? ' ' : '') + t;
        }
      }
      return txt.slice(0, 40);
    };

    const hasAccessibleName = (el, tag) => {
      const ariaLabel = el.getAttribute && el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return true;
      const ariaLabelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
      if (ariaLabelledBy && ariaLabelledBy.trim()) return true;
      const title = el.getAttribute && el.getAttribute('title');
      if (title && title.trim()) return true;
      if (tag === 'img') {
        const alt = el.getAttribute && el.getAttribute('alt');
        return alt !== null && alt !== undefined; // empty alt="" marks decorative img
      }
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        const placeholder = el.getAttribute && el.getAttribute('placeholder');
        if (placeholder && placeholder.trim()) return true;
        if (el.id && typeof document.querySelector === 'function') {
          try {
            if (document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]')) return true;
          } catch {}
        }
        if (typeof el.closest === 'function' && el.closest('label')) return true;
        return false;
      }
      const text = (el.textContent || '').trim();
      if (text) return true;
      return false;
    };

    const viewportWidth = (document.documentElement && document.documentElement.clientWidth) || window.innerWidth || 1024;
    const checkTouchTargets = forceTouchTargets === true || (forceTouchTargets === null && viewportWidth <= 768);
    const interactiveTags = new Set(['button', 'select', 'textarea']);
    const interactiveRoles = new Set(['button', 'link', 'tab', 'checkbox', 'radio', 'switch', 'menuitem']);

    const contrastIssues = [];
    const touchTargetIssues = [];
    const missingNames = [];
    const headingIssues = [];

    let scannedElements = 0;
    let skippedHiddenElements = 0;
    let unverifiableContrastCount = 0;
    let h1Count = 0;
    let lastHeadingLevel = 0;

    const elements = rawElements.filter(el => !el.closest || !el.closest('[data-spector-activity]'));

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!(el instanceof HTMLElement)) continue;
      if (isHiddenOrInHiddenAncestor(el)) {
        skippedHiddenElements++;
        continue;
      }
      if (scannedElements >= maxElements) break;
      scannedElements++;

      const cs = getStyle(el);
      const tag = (el.tagName || '').toLowerCase();
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
      const ariaHidden = el.getAttribute && el.getAttribute('aria-hidden') === 'true';

      // 1. Heading hierarchy
      if (/^h[1-6]$/.test(tag) && !ariaHidden && headingIssues.length < maxIssues) {
        const level = Number(tag.charAt(1));
        if (level === 1) {
          h1Count++;
          if (h1Count > 1) {
            headingIssues.push({
              selector: getCssSelector(el),
              tag,
              issue: 'multiple-h1',
              detail: 'Multiple <h1> headings found on page (#' + h1Count + ').'
            });
          }
        }
        if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
          headingIssues.push({
            selector: getCssSelector(el),
            tag,
            issue: 'skipped-level',
            detail: 'Heading level jumped from <h' + lastHeadingLevel + '> to <h' + level + '>.'
          });
        }
        lastHeadingLevel = level;
      }

      // 2. Interactive checks (missing accessible names & touch target size)
      const role = (el.getAttribute && el.getAttribute('role')) || '';
      const isHrefLink = tag === 'a' && Boolean(el.getAttribute && el.getAttribute('href'));
      const isVisibleInput = tag === 'input' && ((el.getAttribute && el.getAttribute('type')) || 'text').toLowerCase() !== 'hidden';
      const isInteractive = interactiveTags.has(tag) || isHrefLink || isVisibleInput || interactiveRoles.has(role);

      if (!ariaHidden && (isInteractive || tag === 'img') && missingNames.length < maxIssues) {
        if (!hasAccessibleName(el, tag)) {
          missingNames.push({
            selector: getCssSelector(el),
            tag,
            ...(role ? { role } : {}),
            reason: tag === 'img'
              ? 'Image is missing alt attribute (use alt="" if decorative).'
              : 'Interactive <' + tag + '> has no accessible name (add text, aria-label, or associated label).'
          });
        }
      }

      if (checkTouchTargets && isInteractive && !ariaHidden && rect.width > 0 && rect.height > 0 && touchTargetIssues.length < maxIssues) {
        if (rect.width < 44 || rect.height < 44) {
          touchTargetIssues.push({
            selector: getCssSelector(el),
            tag,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            minRequired: 44
          });
        }
      }

      // 3. WCAG AA Contrast check on direct text-bearing elements
      const textSample = getDirectTextSample(el);
      if (textSample && rect.width > 0 && rect.height > 0 && contrastIssues.length < maxIssues) {
        const fgRaw = parseRgba(cs.color);
        if (!fgRaw || fgRaw.a === 0) {
          if (cs.color) unverifiableContrastCount++;
        } else {
          const bgResolved = resolveEffectiveBackground(el);
          if (bgResolved.unverifiable || !bgResolved.color) {
            unverifiableContrastCount++;
          } else {
            const fg = fgRaw.a < 0.999 ? blendOver(fgRaw, bgResolved.color) : fgRaw;
            const ratio = contrastRatio(fg, bgResolved.color);
            const fontSizePx = parseFloat(cs.fontSize || '16') || 16;
            const fontWeightNum = parseInt(cs.fontWeight || '400', 10) || (cs.fontWeight === 'bold' ? 700 : 400);
            const isLarge = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeightNum >= 700);
            const requiredRatio = isLarge ? 3.0 : 4.5;
            if (ratio < requiredRatio) {
              contrastIssues.push({
                selector: getCssSelector(el),
                textSample,
                color: cs.color,
                backgroundColor: bgResolved.css,
                ratio: Math.round(ratio * 100) / 100,
                requiredRatio,
                fontSize: cs.fontSize || '16px',
                fontWeight: cs.fontWeight || '400'
              });
            }
          }
        }
      }
    }

    return {
      coverage: {
        scope: rawRootSelector ? 'scoped-light-dom' : 'document-light-dom',
        ...(rawRootSelector ? { rootSelector: rawRootSelector } : {}),
        scannedElements,
        ...(skippedHiddenElements > 0 ? { skippedHiddenElements } : {}),
        unverifiableContrastCount,
        touchTargetsChecked: checkTouchTargets,
        issueLimitPerCategory: maxIssues
      },
      contrastIssues,
      touchTargetIssues,
      missingNames,
      headingIssues
    };
  })()`;

  const result = await evaluateInPage(page, script);
  if (result && typeof result === 'object' && '__spectorRootMissing' in result) {
    throw new SpectorError('ELEMENT_NOT_READY', `Root selector "${rawRootSelector}" not found in active document.`);
  }
  if (!result || typeof result !== 'object' || !Array.isArray((result as AccessibilityForensicsReport).contrastIssues)) {
    return undefined;
  }
  return result as AccessibilityForensicsReport;
}
