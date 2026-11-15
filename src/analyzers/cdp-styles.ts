import type { CDPSession, Page } from 'playwright-core';
import type { CssCascadeEntry, CssCascadeReport, PseudoStateDelta } from '../types.js';
import { TIMEOUTS } from '../constants.js';
import { escapeTailwindSelector } from '../utils/selector.js';
import { SpectorError } from '../utils/mcp-response.js';
import { withCdpSession } from '../utils/cdp.js';

const PSEUDO_TRACKED_PROPS = [
  'backgroundColor',
  'color',
  'borderColor',
  'borderTopColor',
  'boxShadow',
  'transform',
  'opacity',
  'outlineColor',
  'outlineWidth',
  'textDecorationColor',
  'scale'
] as const;

const DEFAULT_CASCADE_PROPERTIES = [
  'display',
  'position',
  'z-index',
  'width',
  'height',
  'max-width',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'overflow',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'flex-direction',
  'justify-content',
  'align-items',
  'opacity',
  'visibility'
] as const;

async function resolveNodeId(cdp: CDPSession, escapedSelector: string): Promise<number> {
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: escapedSelector
  });
  return nodeId;
}

export async function extractPseudoStateDelta(
  page: Page,
  selector: string,
  pseudoState: ':hover' | ':focus-visible' = ':hover',
  timeoutMs: number = TIMEOUTS.CDP_CONNECT_MS
): Promise<PseudoStateDelta | undefined> {
  const escaped = escapeTailwindSelector(selector);
  const cdpPseudo = pseudoState === ':focus-visible' ? 'focus-visible' : 'hover';

  const readSnapshot = async () => {
    return await page.evaluate(
      ({ sel, props }) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        // Finish finite CSS transitions so the delta describes endpoint styles, including transition-delay.
        for (const animation of el.getAnimations()) {
          if (animation instanceof CSSTransition) animation.finish();
        }
        const cs = window.getComputedStyle(el);
        const values: Record<string, string> = {};
        for (const p of props) {
          values[p] = String((cs as unknown as Record<string, unknown>)[p] ?? '');
        }
        return {
          values,
          transition: {
            property: cs.transitionProperty,
            duration: cs.transitionDuration,
            timingFunction: cs.transitionTimingFunction
          }
        };
      },
      { sel: escaped, props: [...PSEUDO_TRACKED_PROPS] }
    );
  };

  const snapshots = await withCdpSession(page, timeoutMs, `extractPseudoStateDelta(${pseudoState})`, async (cdp) => {
    // Clear lingering click hover before reading the resting baseline so normal vs active styles separate cleanly.
    if (pseudoState === ':hover') {
      await cdp
        .send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: -1,
          y: -1
        })
        .catch(() => {});
    }

    const baseline = await readSnapshot();
    if (!baseline) return null;

    const nodeId = await resolveNodeId(cdp, escaped);
    if (!nodeId) return null;

    try {
      await cdp.send('CSS.forcePseudoState', {
        nodeId,
        forcedPseudoClasses: [cdpPseudo]
      });
      const after = await readSnapshot();
      return after ? { baseline, after } : null;
    } finally {
      await cdp
        .send('CSS.forcePseudoState', {
          nodeId,
          forcedPseudoClasses: []
        })
        .catch(() => {});
    }
  });

  if (!snapshots) return undefined;
  const { baseline, after: afterSnapshot } = snapshots;

  const changes: Record<string, { normal: string; active: string }> = {};
  for (const prop of PSEUDO_TRACKED_PROPS) {
    const before = baseline.values[prop];
    const after = afterSnapshot.values[prop];
    if (before !== after) {
      changes[prop] = { normal: before, active: after };
    }
  }

  const hasTransition =
    baseline.transition.duration &&
    baseline.transition.duration !== '0s' &&
    baseline.transition.property !== 'none';

  if (Object.keys(changes).length === 0 && !hasTransition) {
    return undefined;
  }

  return {
    pseudoState,
    changes,
    ...(hasTransition ? { transition: baseline.transition } : {})
  };
}

interface CascadeDeclaration {
  value: string;
  source: string;
  important: boolean;
  isInline: boolean;
  order: number;
  layerOrder: number;
}

export async function explainCssCascade(
  page: Page,
  selector: string,
  properties?: string[],
  timeoutMs: number = TIMEOUTS.CDP_CONNECT_MS
): Promise<CssCascadeReport> {
  const escaped = escapeTailwindSelector(selector);
  const trackedSet = new Set(
    (properties && properties.length > 0 ? properties : [...DEFAULT_CASCADE_PROPERTIES]).map(p => p.toLowerCase())
  );

  return await withCdpSession(page, timeoutMs, 'explainCssCascade', async (cdp) => {
    const nodeId = await resolveNodeId(cdp, escaped);
    if (!nodeId) {
      throw new SpectorError('ELEMENT_NOT_READY', `Element not found for CSS cascade selector "${selector}".`);
    }

    const matched: any = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
    const layerOrders = new Map<string, number>();
    if (matched.matchedCSSRules?.some((entry: any) => entry.rule?.layers?.length)) {
      const { rootLayer } = await cdp.send('CSS.getLayersForNode', { nodeId });
      const visit = (layer: { name: string; order: number; subLayers?: any[] }, parent: string) => {
        const path = parent ? `${parent}.${layer.name}` : layer.name;
        layerOrders.set(path, layer.order);
        for (const child of layer.subLayers || []) visit(child, path);
      };
      for (const layer of rootLayer.subLayers || []) visit(layer, '');
    }
    const byProp = new Map<string, CascadeDeclaration[]>();
    let order = 0;

    const pushDecl = (propName: string, value: string, source: string, important: boolean, isInline: boolean, layerOrder: number) => {
      const name = propName.toLowerCase();
      if (!trackedSet.has(name)) return;
      const list = byProp.get(name) || [];
      list.push({ value, source, important, isInline, order: ++order, layerOrder });
      byProp.set(name, list);
    };

    // CDP may supply both authored and expanded copies of the same declaration.
    const declarations = (style: any): any[] => {
      const seen = new Set<string>();
      return [...(style?.cssProperties || [])].reverse().filter(prop => {
        if (!prop.name || !prop.value || prop.disabled || prop.parsedOk === false) return false;
        const key = `${prop.name.toLowerCase()}|${prop.value.replace(/\s*!important\s*$/i, '').trim()}|${Boolean(prop.important)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).reverse();
    };

    for (const entry of matched.matchedCSSRules || []) {
      const rule = entry.rule;
      if (!rule || rule.origin === 'user-agent') continue;
      if (rule.supports?.some((condition: any) => condition.active === false)) continue;
      if (rule.media?.some((media: any) => media.mediaList?.length && !media.mediaList.some((query: any) => query.active))) continue;
      const selectorText = rule.selectorList?.text || '(rule)';
      const originTag = rule.origin && rule.origin !== 'regular' ? ` [${rule.origin}]` : '';
      const layerNames = (rule.layers || []).map((layer: any) => layer.text);
      const forwardPath = layerNames.join('.');
      const reversePath = [...layerNames].reverse().join('.');
      const layerPath = layerOrders.has(forwardPath) ? forwardPath : reversePath;
      const layerOrder = layerPath ? layerOrders.get(layerPath) : Number.POSITIVE_INFINITY;
      if (layerOrder === undefined) {
        throw new Error(`Cannot determine CSS layer order for ${layerPath}.`);
      }
      const sourceLabel = `${selectorText}${originTag}${layerPath ? ` [layer: ${layerPath}]` : ''}`;
      for (const prop of declarations(rule.style)) {
        pushDecl(prop.name, prop.value, sourceLabel, Boolean(prop.important), false, layerOrder);
      }
    }

    if (matched.inlineStyle?.cssProperties) {
      for (const prop of declarations(matched.inlineStyle)) {
        pushDecl(prop.name, prop.value, 'element.style (inline)', Boolean(prop.important), true, Number.POSITIVE_INFINITY);
      }
    }

    const resultProps: Record<string, CssCascadeEntry> = {};

    for (const [propName, candidates] of byProp.entries()) {
      if (candidates.length === 0) continue;

      const sorted = [...candidates].sort((a, b) => {
        if (a.important !== b.important) return a.important ? -1 : 1;
        if (a.isInline !== b.isInline) return a.isInline ? -1 : 1;
        if (a.layerOrder !== b.layerOrder) {
          // Important declarations reverse layer priority, including the implicit unlayered scope.
          return a.important ? a.layerOrder - b.layerOrder : b.layerOrder - a.layerOrder;
        }
        return b.order - a.order;
      });

      const winner = sorted[0];
      const overridden = sorted.slice(1).map((loser) => {
        let reason = 'lower specificity or earlier rule order';
        if (winner.important && !loser.important) {
          reason = 'overridden by !important';
        } else if (winner.isInline && !loser.isInline) {
          reason = 'overridden by inline style';
        } else if (winner.layerOrder !== loser.layerOrder) {
          reason = winner.important ? 'overridden by earlier important cascade layer' : 'overridden by higher cascade layer';
        }
        return {
          value: loser.value,
          source: loser.source,
          reason
        };
      });

      resultProps[propName] = {
        winningValue: winner.value,
        winningSource: winner.source,
        ...(winner.important ? { important: true } : {}),
        overridden
      };
    }

    return {
      selector,
      properties: resultProps
    };
  });
}
