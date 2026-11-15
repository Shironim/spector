import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import {
  IN_BROWSER_BLUEPRINT_EXTRACTOR_FN,
  computeComparisonDiff
} from '../../src/analyzers/design-blueprint.js';
import { explainCssCascade, extractPseudoStateDelta } from '../../src/analyzers/cdp-styles.js';
import { runLayoutForensics } from '../../src/analyzers/layout-forensics.js';
import { runAnimationForensics } from '../../src/analyzers/animation-forensics.js';
import { buildTokenMap, normalizeCssColor } from '../../src/analyzers/token-mapper.js';
import { parsePickerPayload } from '../../src/browser/picker-payload.js';
import { HOTKEY_BINDING_SCRIPT, OVERLAY_ENGINE_SCRIPT } from '../../src/browser/overlay-script.js';
import { IN_BROWSER_CSS_SELECTOR_FN } from '../../src/utils/selector.js';
import { IN_BROWSER_COMPONENT_DETECTOR_FN } from '../../src/utils/framework-detector.js';
import type { PickedElementInfo } from '../../src/types.js';

describe('Spector v2 Analyzers & Multi-Pin Architecture', () => {
  it('extracts full typography, layout, surface styles, subtree summary, and SVG/img metadata', () => {
    const headingEl: any = {
      tagName: 'H2',
      childNodes: [{ nodeType: 3, textContent: 'Pricing Plans' }],
      children: [],
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ x: 20, y: 40, width: 200, height: 32 }),
      _cs: {
        display: 'block',
        color: 'rgb(15, 23, 42)',
        fontFamily: 'Inter, sans-serif',
        fontSize: '24px',
        fontWeight: '700',
        lineHeight: '32px',
        letterSpacing: '-0.02em',
        textAlign: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        backgroundImage: 'none',
        borderRadius: '0px',
        gap: 'normal',
        padding: '0px',
        visibility: 'visible'
      }
    };

    const smallSvg: any = {
      tagName: 'svg',
      outerHTML: '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>',
      getAttribute: (k: string) => (k === 'viewBox' ? '0 0 24 24' : k === 'aria-label' ? 'Check' : null),
      querySelector: () => null,
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 20, height: 20 })
    };

    const imgEl: any = {
      tagName: 'IMG',
      currentSrc: 'https://cdn.example.com/images/hero.png?token=PRIVATE',
      alt: 'Hero banner',
      complete: true,
      naturalWidth: 800,
      naturalHeight: 400,
      getAttribute: () => '/images/hero.png',
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 400, height: 400 })
    };

    const rootEl: any = {
      tagName: 'SECTION',
      children: [headingEl],
      querySelectorAll: (sel: string) => {
        if (sel === '*') return [headingEl];
        if (sel === 'svg') return [smallSvg];
        if (sel === 'img') return [imgEl];
        return [];
      },
      getBoundingClientRect: () => ({ x: 10, y: 20, width: 640, height: 320 }),
      _cs: {
        display: 'flex',
        color: 'rgb(15, 23, 42)',
        fontFamily: 'Inter, sans-serif',
        fontSize: '16px',
        fontWeight: '400',
        lineHeight: '24px',
        letterSpacing: 'normal',
        textAlign: 'start',
        position: 'relative',
        zIndex: '10',
        overflow: 'visible',
        visibility: 'visible',
        opacity: '1',
        pointerEvents: 'auto',
        cursor: 'auto',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gridTemplateColumns: 'none',
        gridTemplateRows: 'auto 1fr',
        gap: '16px',
        maxWidth: '720px',
        minWidth: '0px',
        padding: '24px',
        margin: '0px',
        backgroundColor: 'rgb(255, 255, 255)',
        backgroundImage: 'linear-gradient(rgb(255, 255, 255), rgb(248, 250, 252))',
        borderRadius: '16px',
        border: '1px solid rgb(226, 232, 240)',
        boxShadow: 'rgba(0, 0, 0, 0.1) 0px 10px 25px 0px',
        backdropFilter: 'blur(12px)'
      }
    };

    class HTMLElementMock {}
    Object.setPrototypeOf(headingEl, HTMLElementMock.prototype);
    Object.setPrototypeOf(rootEl, HTMLElementMock.prototype);

    const ctx = vm.createContext({
      HTMLElement: HTMLElementMock,
      URL,
      window: {
        location: { href: 'http://localhost:3000/' },
        getComputedStyle: (el: any) => el._cs
      }
    });

    const extractFn = vm.runInContext(
      `(() => { ${IN_BROWSER_BLUEPRINT_EXTRACTOR_FN}; return extractDesignBlueprint; })()`,
      ctx
    );
    const blueprint = extractFn(rootEl, true, 150, 2048);

    assert.equal(blueprint.computedStyles.fontFamily, 'Inter, sans-serif');
    assert.equal(blueprint.computedStyles.fontSize, '16px');
    assert.equal(blueprint.computedStyles.fontWeight, '400');
    assert.equal(blueprint.computedStyles.lineHeight, '24px');
    assert.equal(blueprint.computedStyles.justifyContent, 'space-between');
    assert.equal(blueprint.computedStyles.alignItems, 'center');
    assert.equal(blueprint.computedStyles.flexWrap, 'wrap');
    assert.equal(blueprint.computedStyles.gridTemplateRows, 'auto 1fr');
    assert.equal(blueprint.computedStyles.maxWidth, '720px');
    assert.equal(blueprint.computedStyles.backdropFilter, 'blur(12px)');
    assert.match(blueprint.computedStyles.backgroundImage, /linear-gradient/);

    assert.ok(blueprint.subtreeSummary);
    assert.equal(blueprint.subtreeSummary.typography[0].role, 'h2');
    assert.equal(blueprint.subtreeSummary.typography[0].fontSize, '24px');

    assert.equal(blueprint.assets.svgs.count, 1);
    assert.equal(blueprint.assets.svgs.items[0].viewBox, '0 0 24 24');
    assert.match(blueprint.assets.svgs.items[0].markup, /<svg/);

    assert.equal(blueprint.assets.images.count, 1);
    assert.equal(blueprint.assets.images.items[0].srcPath, '/images/hero.png');
    assert.doesNotMatch(blueprint.assets.images.items[0].srcPath, /PRIVATE/);
    assert.equal(blueprint.assets.images.items[0].aspectMismatch, true);
  });

  it('manages multi-pin queue, target/reference pairing, quick notes, and style diffing', async () => {
    const manager = new CdpSessionManager();

    const refPin: PickedElementInfo = {
      id: 'pin-1',
      role: 'reference',
      pinMode: 'element',
      note: 'Match button padding and hover color',
      tabUrl: 'https://reference.example/',
      status: 'selected',
      selector: '.cta-ref',
      rect: { x: 0, y: 0, width: 160, height: 48 },
      computedStyles: {
        padding: '12px 24px',
        backgroundColor: 'rgb(37, 99, 235)',
        borderRadius: '12px'
      },
      hoverState: {
        pseudoState: ':hover',
        changes: {
          backgroundColor: { normal: 'rgb(37, 99, 235)', active: 'rgb(29, 78, 216)' }
        }
      }
    };

    const targetPin: PickedElementInfo = {
      id: 'pin-2',
      role: 'target',
      pinMode: 'element',
      note: 'Our checkout button',
      tabUrl: 'http://localhost:3000/',
      status: 'selected',
      selector: '#checkout-btn',
      rect: { x: 0, y: 0, width: 120, height: 40 },
      computedStyles: {
        padding: '8px 16px',
        backgroundColor: 'rgb(15, 23, 42)',
        borderRadius: '12px'
      }
    };

    manager.addPin(refPin);
    manager.addPin(targetPin);

    const res = await manager.getLastPicked();
    assert.ok(res);
    assert.equal(res.pins.length, 2);
    assert.equal(res.pins[0].note, 'Match button padding and hover color');
    assert.ok(res.comparison);
    assert.deepEqual(res.comparison.dimensionDelta, { widthDiff: 40, heightDiff: 8 });
    assert.deepEqual(res.comparison.styleDiffs.padding, {
      target: '8px 16px',
      reference: '12px 24px'
    });
    assert.equal(res.comparison.styleDiffs.borderRadius, undefined);
    assert.deepEqual(res.comparison.hoverDiffs?.backgroundColor, {
      target: undefined,
      reference: 'rgb(29, 78, 216)'
    });

    assert.equal(manager.clearPins(), 2);
    assert.equal(await manager.getLastPicked(), null);
  });

  it('computes clean comparison diff directly via computeComparisonDiff', () => {
    const diff = computeComparisonDiff(
      { status: 'selected', selector: '#a', computedStyles: { color: 'red', display: 'flex' } },
      { status: 'selected', selector: '#b', computedStyles: { color: 'blue', display: 'flex' } }
    );
    assert.deepEqual(diff.styleDiffs, { color: { target: 'red', reference: 'blue' } });
  });

  it('forces :hover pseudo-state via CDP, clears lingering click hover before baseline, and resets forced pseudo-states', async () => {
    const cdpCalls: Array<{ method: string; params: any }> = [];
    let isPointerHoverActive = true;
    let isHoverForced = false;
    let detached = false;

    const fakeCdp = {
      send: async (method: string, params?: any) => {
        cdpCalls.push({ method, params });
        if (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseMoved' && params?.x === -1) {
          isPointerHoverActive = false;
          return {};
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelector') return { nodeId: 42 };
        if (method === 'CSS.forcePseudoState') {
          isHoverForced = Array.isArray(params?.forcedPseudoClasses) && params.forcedPseudoClasses.includes('hover');
          return {};
        }
        return {};
      },
      detach: async () => {
        detached = true;
      }
    };

    const fakePage: any = {
      context: () => ({ newCDPSession: async () => fakeCdp }),
      evaluate: async () => {
        const hoverActive = isPointerHoverActive || isHoverForced;
        return {
          values: {
            backgroundColor: hoverActive ? 'rgb(29, 78, 216)' : 'rgb(37, 99, 235)',
            color: 'rgb(255, 255, 255)',
            borderColor: 'rgb(37, 99, 235)',
            borderTopColor: 'rgb(37, 99, 235)',
            boxShadow: 'none',
            transform: hoverActive ? 'matrix(1, 0, 0, 1, 0, -2)' : 'none',
            opacity: '1',
            outlineColor: 'rgb(255, 255, 255)',
            outlineWidth: '0px',
            textDecorationColor: 'rgb(255, 255, 255)',
            scale: 'none'
          },
          transition: {
            property: 'background-color, transform',
            duration: '0.15s',
            timingFunction: 'ease'
          }
        };
      }
    };

    const delta = await extractPseudoStateDelta(fakePage, '.w-[200px]', ':hover');
    assert.ok(delta);
    assert.equal(delta.pseudoState, ':hover');
    assert.deepEqual(delta.changes.backgroundColor, {
      normal: 'rgb(37, 99, 235)',
      active: 'rgb(29, 78, 216)'
    });
    assert.equal(delta.transition?.duration, '0.15s');
    assert.ok(
      cdpCalls.some(c => c.method === 'Input.dispatchMouseEvent' && c.params?.x === -1 && c.params?.y === -1)
    );

    const lastForceCall = cdpCalls.filter(c => c.method === 'CSS.forcePseudoState').pop();
    assert.deepEqual(lastForceCall?.params.forcedPseudoClasses, []);
    assert.equal(isHoverForced, false);
    assert.equal(detached, true);

    cdpCalls.length = 0;
    await extractPseudoStateDelta(fakePage, '.w-[200px]', ':focus-visible');
    assert.equal(
      cdpCalls.some(c => c.method === 'Input.dispatchMouseEvent'),
      false
    );
  });

  it('explains CSS cascade winners and overridden rules via CDP CSS.getMatchedStylesForNode', async () => {
    const fakeCdp = {
      send: async (method: string) => {
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelector') return { nodeId: 10 };
        if (method === 'CSS.getMatchedStylesForNode') {
          return {
            matchedCSSRules: [
              {
                rule: {
                  origin: 'regular',
                  selectorList: { text: '.btn' },
                  style: {
                    cssProperties: [
                      { name: 'padding', value: '12px' },
                      { name: 'color', value: 'blue', important: true }
                    ]
                  }
                }
              },
              {
                rule: {
                  origin: 'regular',
                  selectorList: { text: '.btn-override' },
                  style: {
                    cssProperties: [
                      { name: 'padding', value: '20px' },
                      { name: 'color', value: 'red' }
                    ]
                  }
                }
              }
            ],
            inlineStyle: {
              cssProperties: [{ name: 'color', value: 'green' }]
            }
          };
        }
        return {};
      },
      detach: async () => {}
    };

    const fakePage: any = {
      context: () => ({ newCDPSession: async () => fakeCdp })
    };

    const cascade = await explainCssCascade(fakePage, '.btn-override', ['padding', 'color']);
    assert.equal(cascade.properties.padding.winningValue, '20px');
    assert.equal(cascade.properties.padding.winningSource, '.btn-override');
    assert.equal(cascade.properties.padding.overridden[0].value, '12px');

    assert.equal(cascade.properties.color.winningValue, 'blue');
    assert.equal(cascade.properties.color.important, true);
    assert.equal(cascade.properties.color.overridden.length, 2);
    assert.equal(cascade.properties.color.overridden[0].reason, 'overridden by !important');
  });

  it('detects horizontal overflow culprits, sticky clipping traps, broken media, and font errors in layout forensics', async () => {
    class ElementMock {
      nodeType = 1;
      parentElement: any = null;
      children: any[] = [];
      id = '';
      className = '';
      tagName = 'DIV';
      closest() { return null; }
      getAttribute() {
        return null;
      }
      contains(other: any) {
        return this === other;
      }
    }
    class HTMLElementMock extends ElementMock {
      scrollWidth = 100;
      clientWidth = 100;
    }
    class SVGElementMock extends ElementMock {}
    class HTMLImageElementMock extends HTMLElementMock {
      override tagName = 'IMG';
      complete = true;
      naturalWidth = 0;
      naturalHeight = 0;
      currentSrc = 'https://fixture.invalid/missing.png?secret=XYZ';
    }

    const bodyEl: any = new HTMLElementMock();
    bodyEl.tagName = 'BODY';
    bodyEl._cs = { display: 'block', visibility: 'visible' };

    const overflowBox: any = new HTMLElementMock();
    overflowBox.id = 'wide-banner';
    overflowBox.parentElement = bodyEl;
    overflowBox._cs = {
      display: 'block',
      visibility: 'visible',
      whiteSpace: 'nowrap',
      minWidth: '500px',
      overflow: 'visible',
      overflowX: 'visible',
      overflowY: 'visible',
      position: 'static',
      zIndex: 'auto'
    };
    overflowBox.getBoundingClientRect = () => ({ x: 0, y: 0, width: 500, height: 40, left: 0, right: 500 });

    const clipParent: any = new HTMLElementMock();
    clipParent.id = 'clip-parent';
    clipParent.parentElement = bodyEl;
    clipParent._cs = {
      display: 'block',
      visibility: 'visible',
      overflow: 'hidden',
      overflowX: 'hidden',
      overflowY: 'hidden',
      position: 'static',
      zIndex: 'auto',
      transform: 'none',
      filter: 'none',
      isolation: 'auto',
      opacity: '1'
    };
    clipParent.getBoundingClientRect = () => ({ x: 0, y: 50, width: 300, height: 200, left: 0, right: 300 });

    const stickyChild: any = new HTMLElementMock();
    stickyChild.id = 'sticky-nav';
    stickyChild.parentElement = clipParent;
    stickyChild._cs = {
      display: 'block',
      visibility: 'visible',
      position: 'sticky',
      overflow: 'visible',
      overflowX: 'visible',
      overflowY: 'visible',
      zIndex: 'auto'
    };
    stickyChild.getBoundingClientRect = () => ({ x: 0, y: 50, width: 300, height: 40, left: 0, right: 300 });

    const brokenImg: any = new HTMLImageElementMock();
    brokenImg.id = 'broken-logo';
    brokenImg.parentElement = bodyEl;
    brokenImg._cs = {
      display: 'block',
      visibility: 'visible',
      overflow: 'visible',
      overflowX: 'visible',
      overflowY: 'visible',
      position: 'static',
      zIndex: 'auto'
    };
    brokenImg.getBoundingClientRect = () => ({ x: 0, y: 300, width: 100, height: 100, left: 0, right: 100 });

    const docNodes = [overflowBox, clipParent, stickyChild, brokenImg];
    const page = {
      evaluate: async (fnOrExpr: Function | string, args?: any) =>
        vm.runInContext(
          typeof fnOrExpr === 'string' ? fnOrExpr : `(${fnOrExpr.toString()})(args)`,
          vm.createContext({
            args,
            URL,
            CSS: { escape: (s: string) => s },
            HTMLElement: HTMLElementMock,
            SVGElement: SVGElementMock,
            HTMLImageElement: HTMLImageElementMock,
            document: {
              documentElement: { clientWidth: 375, scrollWidth: 500 },
              body: bodyEl,
              querySelectorAll: (sel: string) => {
                if (sel === 'body *') return docNodes;
                if (sel.startsWith('#')) {
                  const id = sel.slice(1);
                  return docNodes.filter(n => n.id === id);
                }
                return [];
              },
              fonts: [{ family: 'CustomBrokenFont', status: 'error', weight: '400', style: 'normal' }]
            },
            window: {
              innerWidth: 375,
              location: { href: 'https://fixture.invalid/' },
              getComputedStyle: (el: any) => el._cs
            }
          })
        )
    };

    const report = await runLayoutForensics(page as any);
    assert.equal(report.horizontalOverflow.hasOverflow, true);
    assert.equal(report.horizontalOverflow.culprits[0].selector, '#wide-banner');
    assert.equal(report.horizontalOverflow.culprits[0].overflowPx, 125);

    assert.equal(report.clippingTraps.length, 1);
    assert.equal(report.clippingTraps[0].selector, '#sticky-nav');
    assert.equal(report.clippingTraps[0].ancestorSelector, '#clip-parent');

    assert.equal(report.brokenMedia.length, 1);
    assert.equal(report.brokenMedia[0].selector, '#broken-logo');
    assert.equal(report.brokenMedia[0].srcPath, '/missing.png');
    assert.doesNotMatch(report.brokenMedia[0].srcPath!, /XYZ/);

    assert.equal(report.fontIssues.length, 1);
    assert.equal(report.fontIssues[0].family, 'CustomBrokenFont');
    assert.equal(report.fontIssues[0].status, 'error');
  });

  it('compiles unified overlay & selector scripts cleanly without syntax errors or duplicate selector helpers', () => {
    assert.doesNotThrow(() => new Function(IN_BROWSER_CSS_SELECTOR_FN));
    assert.doesNotThrow(() => new Function(OVERLAY_ENGINE_SCRIPT));
    assert.doesNotThrow(() => new Function(HOTKEY_BINDING_SCRIPT));

    const selectorFnMatches = OVERLAY_ENGINE_SCRIPT.match(/function getCssSelector\(/g) || [];
    assert.equal(selectorFnMatches.length, 1);

    assert.match(OVERLAY_ENGINE_SCRIPT, /role['"],\s*['"]toolbar['"]/);
    assert.match(OVERLAY_ENGINE_SCRIPT, /aria-pressed/);
    assert.match(OVERLAY_ENGINE_SCRIPT, /aria-live/);
    assert.match(OVERLAY_ENGINE_SCRIPT, /new AbortController\(\)/);
    assert.match(OVERLAY_ENGINE_SCRIPT, /requestAnimationFrame/);
    assert.match(OVERLAY_ENGINE_SCRIPT, /ev\.ctrlKey \|\| ev\.metaKey \|\| ev\.altKey/);
  });

  it('detects React, Vue, Livewire, Inertia, Alpine, and Blade hints via decomposed pipeline', () => {
    const doc = { body: { nodeType: 1 }, documentElement: { nodeType: 1 } };
    const ctx = vm.createContext({ document: doc });
    const detectFn = vm.runInContext(
      `(() => { ${IN_BROWSER_COMPONENT_DETECTOR_FN}; return detectFrameworkComponent; })()`,
      ctx
    );

    const makeEl = (extra: Record<string, any> = {}, attrs: Record<string, string> = {}) => ({
      nodeType: 1,
      parentElement: null,
      previousSibling: null,
      hasAttribute: (k: string) => Object.prototype.hasOwnProperty.call(attrs, k),
      getAttribute: (k: string) => attrs[k] ?? null,
      ...extra
    });

    const reactEl = makeEl({
      __reactFiber$xyz: {
        type: Object.assign(function CheckoutButton() {}, { displayName: 'CheckoutButton' }),
        memoizedProps: { variant: 'primary', children: [] },
        _debugSource: { fileName: '/@fs/app/src/CheckoutButton.tsx', lineNumber: 18 }
      }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(detectFn(reactEl))), {
      framework: 'react',
      componentName: 'CheckoutButton',
      sourceFile: '/@fs/app/src/CheckoutButton.tsx',
      sourceLine: 18,
      props: ['variant']
    });

    const vueEl = makeEl({
      __vueParentComponent: {
        type: { __name: 'PricingCard', __file: 'src/PricingCard.vue' },
        props: { plan: 'pro', __v_isVNode: true }
      }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(detectFn(vueEl))), {
      framework: 'vue',
      componentName: 'PricingCard',
      sourceFile: 'src/PricingCard.vue',
      props: ['plan']
    });

    const livewireEl = makeEl({}, { 'wire:snapshot': '{"memo":{"name":"cart-drawer"}}' });
    assert.deepEqual(JSON.parse(JSON.stringify(detectFn(livewireEl))), {
      framework: 'livewire',
      componentName: 'cart-drawer'
    });

    const inertiaEl = makeEl({}, { 'data-page': '{"component":"Dashboard/Index"}' });
    assert.deepEqual(JSON.parse(JSON.stringify(detectFn(inertiaEl))), {
      framework: 'inertia',
      componentName: 'Dashboard/Index',
      sourceFile: 'resources/js/Pages/Dashboard/Index'
    });

    const alpineEl = makeEl({}, { 'x-data': '{ open: false }' });
    assert.deepEqual(JSON.parse(JSON.stringify(detectFn(alpineEl))), {
      framework: 'alpine',
      componentName: '{ open: false }'
    });

    const bladeEl = makeEl({
      previousSibling: { nodeType: 8, textContent: 'Blade: resources/views/components/hero.blade.php' }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(detectFn(bladeEl))), {
      framework: 'blade',
      componentName: 'hero',
      sourceFile: 'resources/views/components/hero.blade.php'
    });
  });

  it('extracts active animations, keyframes, and stagger patterns via runAnimationForensics', async () => {
    const makeAnim = (id: string, delay: number) => ({
      animationName: 'fadeInUp',
      playState: 'running',
      effect: {
        target: { id, nodeType: 1, tagName: 'DIV', className: 'card', parentElement: null },
        getTiming: () => ({ duration: 420, delay, iterations: 1, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', direction: 'normal', fill: 'forwards' }),
        getKeyframes: () => [
          { offset: 0, computedOffset: 0, easing: 'linear', opacity: '0', transform: 'translateY(16px)' },
          { offset: 1, computedOffset: 1, easing: 'linear', opacity: '1', transform: 'translateY(0px)' }
        ]
      }
    });

    const page = {
      evaluate: async (script: string) =>
        vm.runInContext(
          script,
          vm.createContext({
            CSS: { escape: (s: string) => s },
            document: {
              getAnimations: () => [makeAnim('c1', 0), makeAnim('c2', 60), makeAnim('c3', 120)],
              querySelectorAll: () => [{}]
            }
          })
        )
    };

    const report = await runAnimationForensics(page as any);
    assert.equal(report.activeCount, 3);
    assert.equal(report.animations.length, 3);
    assert.equal(report.animations[0].type, 'css-animation');
    assert.equal(report.animations[0].durationMs, 420);
    assert.equal(report.animations[0].easing, 'cubic-bezier(0.16, 1, 0.3, 1)');
    assert.equal(report.animations[0].keyframes?.[0].props.opacity, '0');
    assert.equal(report.staggerPatterns?.length, 1);
    assert.equal(report.staggerPatterns?.[0].stepMs, 60);
    assert.equal(report.staggerPatterns?.[0].count, 3);

    const parsed = parsePickerPayload({
      status: 'selected',
      role: 'single',
      pinMode: 'element',
      selector: '#c1',
      animations: [{
        type: 'css-animation',
        name: 'fadeInUp',
        durationMs: 420,
        delayMs: 0,
        iterations: 1,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        keyframes: [{ offset: 0, props: { opacity: '0' } }]
      }]
    });
    assert.equal(parsed.pins[0].animations?.[0].durationMs, 420);
  });

  it('detects inactive CSS properties in runLayoutForensics', async () => {
    class ElementMock {
      nodeType = 1;
      tagName = 'DIV';
      id = '';
      parentElement: any = null;
      _cs: Record<string, string> = {};
      getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 20, left: 0, right: 100 }; }
      getAttribute() { return null; }
      closest() { return null; }
      contains() { return false; }
    }
    class HTMLElementMock extends ElementMock {}
    class SVGElementMock extends ElementMock {}
    class HTMLImageElementMock extends HTMLElementMock {}

    const bodyEl: any = new HTMLElementMock();
    bodyEl.tagName = 'BODY';
    bodyEl._cs = { display: 'block', visibility: 'visible' };

    const staticZ: any = new HTMLElementMock();
    staticZ.id = 'static-z';
    staticZ.parentElement = bodyEl;
    staticZ._cs = { display: 'block', visibility: 'visible', position: 'static', zIndex: '50', gap: '12px' };

    const inlineMargin: any = new HTMLElementMock();
    inlineMargin.tagName = 'SPAN';
    inlineMargin.id = 'inline-span';
    inlineMargin.parentElement = bodyEl;
    inlineMargin._cs = { display: 'inline', visibility: 'visible', position: 'static', marginTop: '24px' };

    const page = {
      evaluate: async (fnOrExpr: Function | string) =>
        vm.runInContext(
          typeof fnOrExpr === 'string' ? fnOrExpr : `(${fnOrExpr.toString()})()`,
          vm.createContext({
            URL,
            CSS: { escape: (s: string) => s },
            HTMLElement: HTMLElementMock,
            SVGElement: SVGElementMock,
            HTMLImageElement: HTMLImageElementMock,
            document: {
              documentElement: { clientWidth: 375, scrollWidth: 375 },
              body: bodyEl,
              querySelectorAll: (sel: string) => {
                if (sel === 'body *') return [staticZ, inlineMargin];
                if (sel === '#static-z') return [staticZ];
                if (sel === '#inline-span') return [inlineMargin];
                return [];
              },
              fonts: []
            },
            window: { innerWidth: 375, getComputedStyle: (el: any) => el._cs }
          })
        )
    };

    const report = await runLayoutForensics(page as any);
    assert.ok(report.inactiveCss.some(h => h.selector === '#static-z' && h.property === 'z-index'));
    assert.ok(report.inactiveCss.some(h => h.selector === '#static-z' && h.property === 'gap'));
    assert.ok(report.inactiveCss.some(h => h.selector === '#inline-span' && h.property === 'marginTop'));
  });

  it('maps extracted design tokens to :root CSS variables and Tailwind utility hints', () => {
    assert.equal(normalizeCssColor('#2563eb'), 'rgb(37, 99, 235)');
    assert.equal(normalizeCssColor('#fff'), 'rgb(255, 255, 255)');

    const mapped = buildTokenMap({
      url: 'http://localhost:3000/',
      cssVariables: {
        '--brand-primary': '#2563eb',
        '--radius-card': '12px'
      },
      palette: {
        backgrounds: ['rgb(255, 255, 255)'],
        surfaces: [],
        texts: [],
        accents: ['rgb(37, 99, 235)'],
        borders: []
      },
      typography: {
        fontFamilies: ['Inter, sans-serif'],
        scale: [{ fontSize: '24px', fontWeight: '700', lineHeight: '32px', sampleTags: ['h2'], count: 2 }]
      },
      radii: ['12px'],
      shadows: [],
      containerWidths: ['1280px']
    });

    assert.deepEqual(mapped?.cssVarMatches, {
      'rgb(37, 99, 235)': 'var(--brand-primary)',
      '12px': 'var(--radius-card)'
    });
    assert.deepEqual(mapped?.tailwindHints, {
      '12px': 'rounded-xl',
      '1280px': 'max-w-screen-xl',
      '24px': 'text-2xl'
    });
  });
});
