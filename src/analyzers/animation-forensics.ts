import type { Page } from 'playwright-core';
import type { AnimationForensicsReport } from '../types.js';
import { TOKEN_BUDGETS } from '../constants.js';
import { escapeTailwindSelector, IN_BROWSER_CSS_SELECTOR_FN } from '../utils/selector.js';

export const ANIMATION_LIMITS = {
  MAX_PICKER_ANIMATIONS: 8,
  MAX_KEYFRAMES_PER_ANIM: 8,
  MAX_KEYFRAME_PROPS: 16
} as const;

export const IN_BROWSER_ANIMATION_EXTRACTOR_FN = `
function extractAnimationsForTarget(target, maxItems, includeSelector, cssSelectorFn) {
  if (!target || typeof target.getAnimations !== 'function') return [];
  let rawAnims = [];
  try {
    rawAnims = target.getAnimations({ subtree: true }) || [];
  } catch {
    return [];
  }
  return serializeAnimationsList(rawAnims, maxItems, includeSelector, cssSelectorFn);
}

function serializeAnimationsList(rawAnims, maxItems, includeSelector, cssSelectorFn) {
  const cap = maxItems || 8;
  const metaKeys = new Set(['offset', 'computedOffset', 'easing', 'composite']);
  const results = [];

  for (let i = 0; i < rawAnims.length && results.length < cap; i++) {
    const anim = rawAnims[i];
    if (!anim) continue;

    let type = 'waapi';
    let name = anim.id || undefined;
    if (typeof anim.animationName === 'string' && anim.animationName) {
      type = 'css-animation';
      name = anim.animationName;
    } else if (typeof anim.transitionProperty === 'string' && anim.transitionProperty) {
      type = 'css-transition';
      name = anim.transitionProperty;
    }

    const effect = anim.effect;
    const timing = effect && typeof effect.getTiming === 'function' ? effect.getTiming() : {};
    const durationRaw = timing.duration;
    const durationMs = typeof durationRaw === 'number' && Number.isFinite(durationRaw)
      ? Math.round(durationRaw * 100) / 100
      : 'auto';
    const delayMs = typeof timing.delay === 'number' && Number.isFinite(timing.delay)
      ? Math.round(timing.delay * 100) / 100
      : 0;
    const iterRaw = timing.iterations;
    const iterations = iterRaw === Infinity ? 'Infinity' : (typeof iterRaw === 'number' && Number.isFinite(iterRaw) ? iterRaw : 1);
    const easing = typeof timing.easing === 'string' && timing.easing ? timing.easing : 'linear';

    let keyframes;
    if (effect && typeof effect.getKeyframes === 'function') {
      try {
        const rawKf = effect.getKeyframes() || [];
        const kfCap = Math.min(rawKf.length, ${ANIMATION_LIMITS.MAX_KEYFRAMES_PER_ANIM});
        const parsedKf = [];
        for (let k = 0; k < kfCap; k++) {
          const kf = rawKf[k];
          if (!kf || typeof kf !== 'object') continue;
          const props = {};
          let propCount = 0;
          const keys = Object.keys(kf);
          for (let p = 0; p < keys.length && propCount < ${ANIMATION_LIMITS.MAX_KEYFRAME_PROPS}; p++) {
            const key = keys[p];
            if (metaKeys.has(key)) continue;
            const val = kf[key];
            if (val !== undefined && val !== null && val !== '') {
              props[key] = String(val).slice(0, 240);
              propCount++;
            }
          }
          if (Object.keys(props).length > 0) {
            const entry = { props };
            if (kf.offset !== undefined) entry.offset = kf.offset;
            else if (kf.computedOffset !== undefined) entry.offset = Math.round(kf.computedOffset * 1000) / 1000;
            if (kf.easing && kf.easing !== 'linear') entry.easing = String(kf.easing);
            parsedKf.push(entry);
          }
        }
        if (parsedKf.length > 0) keyframes = parsedKf;
      } catch {
        // Ignore inaccessible cross-origin or detached keyframe effects.
      }
    }

    let selector;
    if (includeSelector && effect && effect.target && typeof cssSelectorFn === 'function') {
      try {
        selector = cssSelectorFn(effect.target);
      } catch {
        selector = undefined;
      }
    }

    const item = {
      ...(selector ? { selector } : {}),
      type,
      ...(name ? { name } : {}),
      ...(anim.playState ? { playState: String(anim.playState) } : {}),
      durationMs,
      delayMs,
      iterations,
      easing,
      ...(timing.direction && timing.direction !== 'normal' ? { direction: String(timing.direction) } : {}),
      ...(timing.fill && timing.fill !== 'none' ? { fill: String(timing.fill) } : {}),
      ...(keyframes ? { keyframes } : {})
    };
    results.push(item);
  }

  return results;
}
`;

export async function runAnimationForensics(
  page: Page,
  selector?: string
): Promise<AnimationForensicsReport> {
  const maxIssues = TOKEN_BUDGETS.MAX_DIAGNOSE_ISSUES;
  const escaped = selector ? escapeTailwindSelector(selector) : undefined;

  const script = `(() => {
    ${IN_BROWSER_CSS_SELECTOR_FN}
    ${IN_BROWSER_ANIMATION_EXTRACTOR_FN}

    const targetSelector = ${escaped ? JSON.stringify(escaped) : 'null'};
    let rawAnims = [];
    if (targetSelector) {
      const el = document.querySelector(targetSelector);
      if (el && typeof el.getAnimations === 'function') {
        rawAnims = el.getAnimations({ subtree: true }) || [];
      }
    } else if (typeof document.getAnimations === 'function') {
      rawAnims = document.getAnimations() || [];
    }

    const animations = serializeAnimationsList(rawAnims, ${maxIssues}, true, getCssSelector);

    // Detect stagger patterns among animations sharing name + duration + easing.
    const groups = new Map();
    for (const anim of animations) {
      if (!anim.selector) continue;
      const key = (anim.name || anim.type) + '|' + anim.durationMs + '|' + anim.easing;
      if (!groups.has(key)) groups.set(key, { name: anim.name || anim.type, items: [] });
      groups.get(key).items.push(anim);
    }

    const staggerPatterns = [];
    for (const group of groups.values()) {
      if (group.items.length < 3) continue;
      const sorted = group.items.slice().sort((a, b) => a.delayMs - b.delayMs);
      const deltas = [];
      for (let i = 1; i < sorted.length; i++) {
        const d = Math.round((sorted[i].delayMs - sorted[i - 1].delayMs) * 100) / 100;
        if (d > 0) deltas.push(d);
      }
      if (deltas.length < 2) continue;
      const avgStep = Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 100) / 100;
      const consistent = deltas.every(d => Math.abs(d - avgStep) <= Math.max(5, avgStep * 0.25));
      if (consistent) {
        staggerPatterns.push({
          name: group.name,
          count: sorted.length,
          stepMs: avgStep,
          baseDelayMs: sorted[0].delayMs,
          selectors: sorted.map(s => s.selector)
        });
      }
    }

    return {
      activeCount: rawAnims.length,
      animations,
      ...(staggerPatterns.length > 0 ? { staggerPatterns } : {})
    };
  })()`;

  return await page.evaluate(script);
}
