import type { Page } from 'playwright-core';
import type { LayoutForensicsReport } from '../types.js';
import { evaluateInPage } from '../utils/cdp.js';
import { escapeTailwindSelector, IN_BROWSER_CSS_SELECTOR_FN, IN_BROWSER_SANITIZE_PATH_FN, IN_BROWSER_SOURCE_FILE_FN } from '../utils/selector.js';
import { SpectorError } from '../utils/mcp-response.js';
import { TOKEN_BUDGETS } from '../constants.js';

export interface LayoutForensicsOptions {
  rootSelector?: string;
  maxElements?: number;
}

export async function runLayoutForensics(
  page: Page,
  options?: LayoutForensicsOptions
): Promise<LayoutForensicsReport> {
  const maxIssues = TOKEN_BUDGETS.MAX_DIAGNOSE_ISSUES;
  const maxElements = Math.min(
    Math.max(1, Math.floor(options?.maxElements ?? TOKEN_BUDGETS.DEFAULT_DIAGNOSE_MAX_ELEMENTS)),
    TOKEN_BUDGETS.MAX_DIAGNOSE_MAX_ELEMENTS
  );
  const rawRootSelector = options?.rootSelector?.trim() || undefined;
  const escapedRootSelector = rawRootSelector ? escapeTailwindSelector(rawRootSelector) : undefined;

  // Execute via string evaluation so pages with strict CSP (no unsafe-eval) do not block diagnostics.
  const script = `(() => {
    const maxIssues = ${maxIssues};
    const maxElements = ${maxElements};
    const rawRootSelector = ${JSON.stringify(rawRootSelector ?? null)};
    const escapedRootSelector = ${JSON.stringify(escapedRootSelector ?? null)};
    ${IN_BROWSER_CSS_SELECTOR_FN}
    ${IN_BROWSER_SANITIZE_PATH_FN}
    ${IN_BROWSER_SOURCE_FILE_FN}

    const withSourceFile = (el) => {
      const sf = getSourceFile(el);
      return sf ? { sourceFile: sf } : {};
    };

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
      if (!rootEl) {
        return { __spectorRootMissing: true };
      }
      rawElements = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))];
    } else {
      rawElements = Array.from(document.querySelectorAll('body *'));
    }

    const docEl = document.documentElement;
    const clientWidth = docEl.clientWidth || window.innerWidth;
    const viewportHeight = docEl.clientHeight || window.innerHeight || 900;
    const scrollWidth = docEl.scrollWidth;
    const pageVerticallyScrollable = (docEl.scrollHeight || 0) > viewportHeight + 2;
    const hasOverflow = scrollWidth > clientWidth + 1;

    const culprits = [];
    const clippingTraps = [];
    const internalHorizontalScroll = [];
    const clippedInViewport = [];
    const stackingTraps = [];
    const brokenMedia = [];
    const fontIssues = [];
    const inactiveCss = [];

    const isCssSet = (val, defaults) => Boolean(val && !defaults.includes(val));
    const replacedTags = new Set(['img', 'svg', 'input', 'button', 'select', 'textarea', 'canvas', 'video', 'iframe']);
    const interactiveTags = new Set(['button', 'select', 'textarea']);
    const interactiveRoles = new Set(['button', 'link', 'tab']);

    const elements = rawElements.filter(el => !el.closest('[data-spector-activity]'));
    let visitedElements = 0;
    let skippedHiddenElements = 0;
    let skippedRepetitiveElements = 0;
    let elementLimitReached = false;

    // When DOM exceeds maxElements, sample repetitive table/rowgroup rows (first 3 + last 1)
    // so bottom-of-page pagination/footers are not starved while preserving DOM order.
    const skippedRows = new Set();
    if (elements.length > maxElements) {
      const rowGroups = new Map();
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        const role = el.getAttribute ? el.getAttribute('role') : '';
        const parent = el.parentElement;
        if (!parent) continue;
        const pTag = parent.tagName ? parent.tagName.toLowerCase() : '';
        const pRole = parent.getAttribute ? parent.getAttribute('role') : '';
        if ((tag === 'tr' && pTag === 'tbody') || (role === 'row' && pRole === 'rowgroup')) {
          let rows = rowGroups.get(parent);
          if (!rows) { rows = []; rowGroups.set(parent, rows); }
          rows.push(el);
        }
      }
      rowGroups.forEach((rows) => {
        if (rows.length > 4) {
          for (let r = 3; r < rows.length - 1; r++) {
            skippedRows.add(rows[r]);
          }
        }
      });
    }

    const isInSkippedRow = (el) => {
      if (skippedRows.size === 0) return false;
      let curr = el;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        if (skippedRows.has(curr)) return true;
        curr = curr.parentElement;
      }
      return false;
    };

    const hasScrollableAncestor = (el) => {
      let p = el.parentElement;
      while (p && p !== document.body && p !== document.documentElement) {
        const pcs = getStyle(p);
        if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll' || pcs.overflowX === 'hidden' || pcs.overflowX === 'clip') {
          return true;
        }
        p = p.parentElement;
      }
      return false;
    };

    const overflowCandidates = [];

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
      if (isHiddenOrInHiddenAncestor(el)) {
        skippedHiddenElements++;
        continue;
      }
      if (isInSkippedRow(el)) {
        skippedRepetitiveElements++;
        continue;
      }
      if (visitedElements >= maxElements) {
        elementLimitReached = true;
        break;
      }
      visitedElements++;
      const cs = getStyle(el);

      const rect = el.getBoundingClientRect();
      const visuallyHidden = rect.width <= 1 && rect.height <= 1 &&
        (cs.position === 'absolute' || cs.position === 'fixed') &&
        (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)');
      const box = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };

      if (hasOverflow && rect.width > 0 && rect.height > 0 && !hasScrollableAncestor(el)) {
        if (rect.right > clientWidth + 1) {
          const overflowPx = Math.round(rect.right - clientWidth);
          let reason = 'Element right edge extends ' + overflowPx + 'px past viewport (' + clientWidth + 'px)';
          if (cs.whiteSpace === 'nowrap') reason += '; white-space: nowrap';
          if (cs.minWidth && cs.minWidth !== '0px' && cs.minWidth !== 'auto') reason += '; min-width: ' + cs.minWidth;
          overflowCandidates.push({ el, overflowPx, rect: box, reason });
        } else if (rect.left < -1) {
          const overflowPx = Math.round(Math.abs(rect.left));
          overflowCandidates.push({
            el,
            overflowPx,
            rect: box,
            reason: 'Element left edge overflows viewport by ' + overflowPx + 'px'
          });
        }
      }

      if (cs.position === 'sticky' && clippingTraps.length < maxIssues) {
        let ancestor = el.parentElement;
        while (ancestor && ancestor !== document.documentElement) {
          const acs = getStyle(ancestor);
          const ov = acs.overflow;
          const ovX = acs.overflowX;
          const ovY = acs.overflowY;
          if (
            ['hidden', 'clip', 'auto', 'scroll'].includes(ov) ||
            ['hidden', 'clip'].includes(ovX) ||
            ['hidden', 'clip'].includes(ovY)
          ) {
            clippingTraps.push({
              selector: getCssSelector(el),
              issue: 'sticky-clipped-by-ancestor',
              ancestorSelector: getCssSelector(ancestor),
              ancestorOverflow: 'overflow=' + ov + ' (x:' + ovX + ', y:' + ovY + ')',
              rect: box,
              ...withSourceFile(el)
            });
            break;
          }
          ancestor = ancestor.parentElement;
        }
      }

      if (
        (cs.overflow === 'hidden' || cs.overflow === 'clip' || cs.overflowX === 'hidden') &&
        cs.textOverflow !== 'ellipsis' &&
        !visuallyHidden &&
        el instanceof HTMLElement &&
        rect.width > 0 &&
        rect.height > 0 &&
        clippingTraps.length < maxIssues
      ) {
        if (el.scrollWidth > el.clientWidth + 8 && el.clientWidth > 0) {
          clippingTraps.push({
            selector: getCssSelector(el),
            issue: 'content-clipped',
            ancestorOverflow: 'scrollWidth(' + el.scrollWidth + ') > clientWidth(' + el.clientWidth + ') with overflow:' + cs.overflowX,
            rect: box,
            ...withSourceFile(el)
          });
        }
      }

      if (
        (cs.overflowX === 'auto' || cs.overflowX === 'scroll') &&
        !visuallyHidden &&
        el instanceof HTMLElement &&
        rect.width > 0 &&
        rect.height > 0 &&
        el.clientWidth > 0 &&
        el.scrollWidth > el.clientWidth + 8 &&
        internalHorizontalScroll.length < maxIssues
      ) {
        internalHorizontalScroll.push({
          selector: getCssSelector(el),
          scrollWidth: Math.round(el.scrollWidth),
          clientWidth: Math.round(el.clientWidth),
          overflowPx: Math.round(el.scrollWidth - el.clientWidth),
          hasTable: typeof el.querySelector === 'function' ? Boolean(el.querySelector('table')) : false,
          rect: box,
          ...withSourceFile(el)
        });
      }

      if (el instanceof HTMLElement && !visuallyHidden && rect.width > 0 && rect.height > 0 && clippedInViewport.length < maxIssues) {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        const role = (el.getAttribute && el.getAttribute('role')) || '';
        const isHrefLink = tag === 'a' && Boolean(el.getAttribute && el.getAttribute('href'));
        const isVisibleInput = tag === 'input' && ((el.getAttribute && el.getAttribute('type')) || 'text').toLowerCase() !== 'hidden';
        const isInteractive = interactiveTags.has(tag) || isHrefLink || isVisibleInput || interactiveRoles.has(role);
        const isFixedOrSticky = cs.position === 'fixed' || cs.position === 'sticky';

        if (isInteractive || isFixedOrSticky) {
          let recordedClip = false;
          // 1. Check clipping by overflow:hidden/clip ancestor (stop checking an axis once a scrollable ancestor owns it)
          let ancestor = el.parentElement;
          let scrollableY = false;
          let scrollableX = false;
          while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
            const acs = getStyle(ancestor);
            if (acs.overflowY === 'auto' || acs.overflowY === 'scroll') scrollableY = true;
            if (acs.overflowX === 'auto' || acs.overflowX === 'scroll') scrollableX = true;
            const clipY = !scrollableY && (acs.overflowY === 'hidden' || acs.overflowY === 'clip');
            const clipX = !scrollableX && (acs.overflowX === 'hidden' || acs.overflowX === 'clip');
            if (clipY || clipX) {
              const ar = ancestor.getBoundingClientRect();
              if (ar.width > 0 && ar.height > 0) {
                const overBottom = clipY && rect.top < ar.bottom - 1 && rect.bottom > ar.bottom + 2 ? Math.round(rect.bottom - ar.bottom) : 0;
                const overRight = clipX && rect.left < ar.right - 1 && rect.right > ar.right + 2 ? Math.round(rect.right - ar.right) : 0;
                if (overBottom > 0 || overRight > 0) {
                  clippedInViewport.push({
                    selector: getCssSelector(el),
                    tag,
                    edge: overBottom > 0 && overRight > 0 ? 'bottom-right' : overBottom > 0 ? 'bottom' : 'right',
                    clippedPx: Math.max(overBottom, overRight),
                    clippedBy: 'ancestor',
                    ancestorSelector: getCssSelector(ancestor),
                    rect: box,
                    ...withSourceFile(el)
                  });
                  recordedClip = true;
                  break;
                }
              }
            }
            if (scrollableY && scrollableX) break;
            ancestor = ancestor.parentElement;
          }

          // 2. Check viewport edge clipping for fixed/sticky or non-scrollable (h-screen) pages
          if (!recordedClip && (isFixedOrSticky || (!pageVerticallyScrollable && !scrollableY))) {
            const overBottom = rect.top < viewportHeight - 1 && rect.bottom > viewportHeight + 2 ? Math.round(rect.bottom - viewportHeight) : 0;
            const overRight = rect.left < clientWidth - 1 && rect.right > clientWidth + 2 ? Math.round(rect.right - clientWidth) : 0;
            if (overBottom > 0 || overRight > 0) {
              clippedInViewport.push({
                selector: getCssSelector(el),
                tag,
                edge: overBottom > 0 && overRight > 0 ? 'bottom-right' : overBottom > 0 ? 'bottom' : 'right',
                clippedPx: Math.max(overBottom, overRight),
                clippedBy: 'viewport',
                rect: box,
                ...withSourceFile(el)
              });
            }
          }
        }
      }

      if (
        cs.zIndex !== 'auto' &&
        Number(cs.zIndex) >= 10 &&
        stackingTraps.length < maxIssues
      ) {
        let ancestor = el.parentElement;
        while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
          const acs = getStyle(ancestor);
          const createsContext =
            (acs.position !== 'static' && acs.zIndex !== 'auto') ||
            acs.transform !== 'none' ||
            acs.filter !== 'none' ||
            acs.isolation === 'isolate' ||
            (acs.opacity !== '1' && parseFloat(acs.opacity) < 1) ||
            (acs.backdropFilter && acs.backdropFilter !== 'none');

          if (createsContext) {
            const reasons = [];
            if (acs.position !== 'static' && acs.zIndex !== 'auto') reasons.push('z-index:' + acs.zIndex);
            if (acs.transform !== 'none') reasons.push('transform');
            if (acs.filter !== 'none') reasons.push('filter');
            if (acs.isolation === 'isolate') reasons.push('isolation:isolate');
            if (parseFloat(acs.opacity) < 1) reasons.push('opacity:' + acs.opacity);
            if (acs.backdropFilter && acs.backdropFilter !== 'none') reasons.push('backdrop-filter');

            if (acs.zIndex === 'auto' || Number(acs.zIndex) < Number(cs.zIndex)) {
              stackingTraps.push({
                selector: getCssSelector(el),
                zIndex: cs.zIndex,
                trappedInAncestor: getCssSelector(ancestor),
                ancestorContextReason: reasons.join(', '),
                ...withSourceFile(el)
              });
              break;
            }
          }
          ancestor = ancestor.parentElement;
        }
      }

      if (el instanceof HTMLImageElement && brokenMedia.length < maxIssues) {
        if (el.complete && el.naturalWidth === 0) {
          brokenMedia.push({
            tag: 'img',
            selector: getCssSelector(el),
            srcPath: sanitizeUrlPath(el.currentSrc || el.getAttribute('src') || ''),
            reason: 'Image failed to load (naturalWidth === 0)',
            naturalSize: '0x0',
            renderSize: Math.round(rect.width) + 'x' + Math.round(rect.height),
            ...withSourceFile(el)
          });
        } else if (el.naturalWidth > 0 && el.naturalHeight > 0 && rect.width > 0 && rect.height > 0) {
          const natRatio = el.naturalWidth / el.naturalHeight;
          const renRatio = rect.width / rect.height;
          if (Math.abs(natRatio - renRatio) / natRatio > 0.25 && cs.objectFit === 'fill') {
            brokenMedia.push({
              tag: 'img',
              selector: getCssSelector(el),
              srcPath: sanitizeUrlPath(el.currentSrc || el.getAttribute('src') || ''),
              reason: 'Severe aspect ratio distortion (>25%) with object-fit: fill',
              naturalSize: el.naturalWidth + 'x' + el.naturalHeight,
              renderSize: Math.round(rect.width) + 'x' + Math.round(rect.height),
              ...withSourceFile(el)
            });
          }
        }
      } else if (el instanceof SVGElement && el.tagName.toLowerCase() === 'svg' && brokenMedia.length < maxIssues) {
        if (rect.width === 0 || rect.height === 0) {
          brokenMedia.push({
            tag: 'svg',
            selector: getCssSelector(el),
            reason: 'Visible <svg> rendered with 0 width or height',
            renderSize: Math.round(rect.width) + 'x' + Math.round(rect.height),
            ...withSourceFile(el)
          });
        }
      }

      if (el instanceof HTMLElement && inactiveCss.length < maxIssues) {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        const display = cs.display || '';
        const position = cs.position || '';

        if (position === 'static') {
          if (isCssSet(cs.zIndex, ['auto'])) {
            inactiveCss.push({ selector: getCssSelector(el), property: 'z-index', value: cs.zIndex, reason: 'z-index has no effect on position: static elements (unless flex/grid child).', ...withSourceFile(el) });
          } else {
            for (const inset of ['top', 'right', 'bottom', 'left']) {
              if (inactiveCss.length < maxIssues && isCssSet(cs[inset], ['auto'])) {
                inactiveCss.push({ selector: getCssSelector(el), property: inset, value: cs[inset], reason: inset + ' has no effect on position: static elements.', ...withSourceFile(el) });
                break;
              }
            }
          }
        }

        if (display === 'inline' && !replacedTags.has(tag) && inactiveCss.length < maxIssues) {
          for (const dim of ['marginTop', 'marginBottom', 'minWidth', 'minHeight']) {
            if (isCssSet(cs[dim], ['0px', 'auto', 'none'])) {
              inactiveCss.push({ selector: getCssSelector(el), property: dim, value: cs[dim], reason: dim + ' has no effect on non-replaced display: inline elements.', ...withSourceFile(el) });
              break;
            }
          }
        }

        const isFlexOrGrid = display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid';
        if (!isFlexOrGrid && inactiveCss.length < maxIssues) {
          if (isCssSet(cs.gap, ['normal', '0px'])) {
            inactiveCss.push({ selector: getCssSelector(el), property: 'gap', value: cs.gap, reason: 'gap has no effect when display is "' + display + '" (requires flex or grid).', ...withSourceFile(el) });
          } else if (isCssSet(cs.justifyContent, ['normal'])) {
            inactiveCss.push({ selector: getCssSelector(el), property: 'justify-content', value: cs.justifyContent, reason: 'justify-content has no effect when display is "' + display + '".', ...withSourceFile(el) });
          } else if (isCssSet(cs.alignItems, ['normal'])) {
            inactiveCss.push({ selector: getCssSelector(el), property: 'align-items', value: cs.alignItems, reason: 'align-items has no effect when display is "' + display + '".', ...withSourceFile(el) });
          }
        }
      }
    }

    const leafOverflow = overflowCandidates.filter(
      (cand) => !overflowCandidates.some((other) => other !== cand && cand.el.contains(other.el))
    );
    for (const item of leafOverflow.slice(0, maxIssues)) {
      culprits.push({
        selector: getCssSelector(item.el),
        overflowPx: item.overflowPx,
        rect: item.rect,
        reason: item.reason,
        ...withSourceFile(item.el)
      });
    }

    if (document.fonts && typeof document.fonts.forEach === 'function') {
      const seenFonts = new Set();
      document.fonts.forEach((font) => {
        if (font.status === 'error' || font.status === 'loading') {
          const key = font.family + '|' + font.weight + '|' + font.style + '|' + font.status;
          if (!seenFonts.has(key) && fontIssues.length < maxIssues) {
            seenFonts.add(key);
            fontIssues.push({
              family: font.family,
              status: font.status,
              weight: font.weight,
              style: font.style
            });
          }
        }
      });
    }

    return {
      coverage: {
        scope: rawRootSelector ? 'scoped-light-dom' : 'document-light-dom',
        ...(rawRootSelector ? { rootSelector: rawRootSelector } : {}),
        candidateElements: Math.max(visitedElements, elements.length - skippedHiddenElements - skippedRepetitiveElements),
        visitedElements,
        ...(skippedHiddenElements > 0 ? { skippedHiddenElements } : {}),
        ...(skippedRepetitiveElements > 0 ? { skippedRepetitiveElements } : {}),
        elementLimitReached,
        issueLimitPerCategory: maxIssues,
        categoriesAtLimit: Object.entries({ culprits, clippingTraps, internalHorizontalScroll, clippedInViewport, stackingTraps, brokenMedia, fontIssues, inactiveCss }).filter(([, items]) => items.length >= maxIssues).map(([name]) => name),
        excluded: ['iframe-documents', 'shadow-roots', 'display-none', 'visibility-hidden', 'hidden-ancestors']
      },
      horizontalOverflow: {
        hasOverflow,
        scrollWidth,
        clientWidth,
        culprits
      },
      clippingTraps,
      internalHorizontalScroll,
      clippedInViewport,
      stackingTraps,
      brokenMedia,
      fontIssues,
      inactiveCss
    };
  })()`;

  const result = await evaluateInPage(page, script);
  if (result && typeof result === 'object' && '__spectorRootMissing' in result) {
    throw new SpectorError('ELEMENT_NOT_READY', `Root selector "${rawRootSelector}" not found in active document.`);
  }
  return result as LayoutForensicsReport;
}
