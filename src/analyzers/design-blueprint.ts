import type { ComparisonDiff, PickedElementInfo } from '../types.js';
import { TOKEN_BUDGETS } from '../constants.js';
import { IN_BROWSER_SANITIZE_PATH_FN } from '../utils/selector.js';

export const IN_BROWSER_BLUEPRINT_EXTRACTOR_FN = `
function extractDesignBlueprint(target, includeStyles, maxSubtreeElements, maxInlineSvgBytes) {
  const rect = target.getBoundingClientRect();
  ${IN_BROWSER_SANITIZE_PATH_FN}

  let computedStyles = undefined;
  if (includeStyles) {
    const cs = window.getComputedStyle(target);
    const styles = {
      display: cs.display,
      width: Math.round(rect.width) + 'px',
      height: Math.round(rect.height) + 'px',
      color: cs.color,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight
    };

    const addIf = (key, val, isDefault) => {
      if (val && !isDefault(val)) {
        styles[key] = val;
      }
    };

    addIf('letterSpacing', cs.letterSpacing, (v) => v === 'normal' || v === '0px');
    addIf('textAlign', cs.textAlign, (v) => v === 'start');

    addIf('position', cs.position, (v) => v === 'static');
    addIf('zIndex', cs.zIndex, (v) => v === 'auto');
    addIf('overflow', cs.overflow, (v) => v === 'visible');
    addIf('visibility', cs.visibility, (v) => v === 'visible');
    addIf('opacity', cs.opacity, (v) => v === '1');
    addIf('pointerEvents', cs.pointerEvents, (v) => v === 'auto');
    addIf('cursor', cs.cursor, (v) => v === 'auto');
    if (cs.display.includes('flex')) {
      styles.flexDirection = cs.flexDirection;
    } else {
      addIf('flexDirection', cs.flexDirection, (v) => v === 'row');
    }
    addIf('justifyContent', cs.justifyContent, (v) => v === 'normal');
    addIf('alignItems', cs.alignItems, (v) => v === 'normal');
    addIf('flexWrap', cs.flexWrap, (v) => v === 'nowrap');
    addIf('gridTemplateColumns', cs.gridTemplateColumns, (v) => v === 'none');
    addIf('gridTemplateRows', cs.gridTemplateRows, (v) => v === 'none');
    addIf('gap', cs.gap, (v) => v === 'normal' || v === '0px');
    addIf('maxWidth', cs.maxWidth, (v) => v === 'none');
    addIf('minWidth', cs.minWidth, (v) => v === '0px' || v === 'auto');
    addIf('padding', cs.padding, (v) => v === '0px');
    addIf('margin', cs.margin, (v) => v === '0px');

    addIf('backgroundColor', cs.backgroundColor, (v) => v === 'rgba(0, 0, 0, 0)' || v === 'transparent');
    addIf('backgroundImage', cs.backgroundImage, (v) => v === 'none');
    addIf('borderRadius', cs.borderRadius, (v) => v === '0px');
    addIf('border', cs.border, (v) => v === 'none' || v.startsWith('0px'));
    addIf('boxShadow', cs.boxShadow, (v) => v === 'none');
    const backdrop = cs.backdropFilter || cs.webkitBackdropFilter || '';
    addIf('backdropFilter', backdrop, (v) => v === 'none' || v === '');

    computedStyles = styles;
  }

  let subtreeSummary = undefined;
  if (includeStyles && target.children && target.children.length > 0) {
    const typoMap = new Map();
    const surfacesSet = new Set();
    const radiiSet = new Set();
    const gapsSet = new Set();

    const descendants = target.querySelectorAll('*');
    const limit = Math.min(descendants.length, maxSubtreeElements || 150);

    const getDirectText = (node) => {
      for (let i = 0; i < node.childNodes.length; i++) {
        if (node.childNodes[i].nodeType === 3 && node.childNodes[i].textContent && node.childNodes[i].textContent.trim()) {
          return true;
        }
      }
      return false;
    };

    const classifyRole = (tag) => {
      if (/^h[1-6]$/.test(tag)) return tag;
      if (tag === 'button' || tag === 'a') return tag;
      if (tag === 'label' || tag === 'th') return tag;
      return 'text';
    };

    for (let i = 0; i < limit; i++) {
      const child = descendants[i];
      if (!(child instanceof HTMLElement)) continue;
      const cs = window.getComputedStyle(child);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;

      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
        if (surfacesSet.size < 10) surfacesSet.add(cs.backgroundColor);
      }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        if (surfacesSet.size < 10) surfacesSet.add(cs.backgroundImage);
      }
      if (cs.borderRadius && cs.borderRadius !== '0px') {
        if (radiiSet.size < 8) radiiSet.add(cs.borderRadius);
      }
      if (cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') {
        if (gapsSet.size < 8) gapsSet.add('gap:' + cs.gap);
      }
      if (cs.padding && cs.padding !== '0px') {
        if (gapsSet.size < 8) gapsSet.add('pad:' + cs.padding);
      }

      if (getDirectText(child)) {
        const tag = child.tagName.toLowerCase();
        const role = classifyRole(tag);
        const key = [role, cs.fontFamily, cs.fontSize, cs.fontWeight, cs.lineHeight, cs.color].join('|');
        const existing = typoMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          typoMap.set(key, {
            role,
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            color: cs.color,
            count: 1
          });
        }
      }
    }

    const typography = Array.from(typoMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    if (typography.length > 0 || surfacesSet.size > 0 || radiiSet.size > 0 || gapsSet.size > 0) {
      subtreeSummary = {
        typography,
        surfaces: Array.from(surfacesSet),
        radii: Array.from(radiiSet),
        spacingGaps: Array.from(gapsSet)
      };
    }
  }

  const svgEls = target.tagName && target.tagName.toLowerCase() === 'svg'
    ? [target]
    : Array.from(target.querySelectorAll('svg')).slice(0, 10);
  const imgEls = target.tagName && target.tagName.toLowerCase() === 'img'
    ? [target]
    : Array.from(target.querySelectorAll('img')).slice(0, 10);

  const svgItems = [];
  for (const svg of svgEls) {
    const sRect = svg.getBoundingClientRect();
    const viewBox = svg.getAttribute('viewBox') || undefined;
    const ariaLabel = svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent?.trim() || undefined;
    const html = svg.outerHTML || '';
    const byteLimit = maxInlineSvgBytes || 2048;
    const item = {
      ...(ariaLabel ? { ariaLabel } : {}),
      width: Math.round(sRect.width),
      height: Math.round(sRect.height),
      ...(viewBox ? { viewBox } : {})
    };
    if (html.length > 0 && html.length <= byteLimit) {
      item.markup = html;
    } else if (html.length > byteLimit) {
      item.truncated = true;
    }
    svgItems.push(item);
  }

  const imgItems = [];
  for (const img of imgEls) {
    const iRect = img.getBoundingClientRect();
    const renderWidth = Math.round(iRect.width);
    const renderHeight = Math.round(iRect.height);
    const naturalWidth = img.naturalWidth || 0;
    const naturalHeight = img.naturalHeight || 0;
    const broken = !img.complete || naturalWidth === 0;
    let aspectMismatch = false;
    if (!broken && naturalWidth > 0 && naturalHeight > 0 && renderWidth > 0 && renderHeight > 0) {
      const natRatio = naturalWidth / naturalHeight;
      const renRatio = renderWidth / renderHeight;
      if (Math.abs(natRatio - renRatio) / natRatio > 0.15) {
        aspectMismatch = true;
      }
    }
    imgItems.push({
      srcPath: sanitizeUrlPath(img.currentSrc || img.getAttribute('src') || ''),
      ...(img.alt ? { alt: img.alt } : {}),
      naturalWidth,
      naturalHeight,
      renderWidth,
      renderHeight,
      ...(broken ? { broken: true } : {}),
      ...(aspectMismatch ? { aspectMismatch: true } : {})
    });
  }

  const assets = (svgItems.length > 0 || imgItems.length > 0)
    ? {
        ...(svgItems.length > 0 ? { svgs: { count: svgItems.length, items: svgItems } } : {}),
        ...(imgItems.length > 0 ? { images: { count: imgItems.length, items: imgItems } } : {})
      }
    : undefined;

  return {
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    computedStyles,
    subtreeSummary,
    assets
  };
}
`;

export const BLUEPRINT_LIMITS = {
  maxSubtreeElements: TOKEN_BUDGETS.MAX_SUBTREE_ELEMENTS,
  maxInlineSvgBytes: TOKEN_BUDGETS.MAX_INLINE_SVG_BYTES
} as const;

export function computeComparisonDiff(
  target: PickedElementInfo,
  reference: PickedElementInfo
): ComparisonDiff {
  const styleDiffs: Record<string, { target?: string; reference?: string }> = {};
  const tStyles = target.computedStyles || {};
  const rStyles = reference.computedStyles || {};

  const keys = new Set([...Object.keys(tStyles), ...Object.keys(rStyles)]);
  for (const key of keys) {
    if (tStyles[key] !== rStyles[key]) {
      styleDiffs[key] = {
        target: tStyles[key],
        reference: rStyles[key]
      };
    }
  }

  let hoverDiffs: Record<string, { target?: string; reference?: string }> | undefined;
  const tHover = target.hoverState?.changes;
  const rHover = reference.hoverState?.changes;
  const usableHover = (pin: PickedElementInfo) =>
    !pin.enrichment?.hover || pin.enrichment.hover.status === 'captured';
  if ((tHover || rHover) && usableHover(target) && usableHover(reference)) {
    const diffs: Record<string, { target?: string; reference?: string }> = {};
    const hoverKeys = new Set([...Object.keys(tHover || {}), ...Object.keys(rHover || {})]);
    for (const key of hoverKeys) {
      const tVal = tHover?.[key]?.active;
      const rVal = rHover?.[key]?.active;
      if (tVal !== rVal) {
        diffs[key] = { target: tVal, reference: rVal };
      }
    }
    if (Object.keys(diffs).length > 0) {
      hoverDiffs = diffs;
    }
  }

  const dimensionDelta =
    target.rect && reference.rect
      ? {
          widthDiff: reference.rect.width - target.rect.width,
          heightDiff: reference.rect.height - target.rect.height
        }
      : undefined;

  return {
    targetId: target.id,
    referenceId: reference.id,
    targetSelector: target.selector,
    referenceSelector: reference.selector,
    dimensionDelta,
    styleDiffs,
    ...(hoverDiffs ? { hoverDiffs } : {})
  };
}
