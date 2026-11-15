import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { enrichFrameworkComponent, normalizeSourceFile, IN_BROWSER_COMPONENT_DETECTOR_FN } from '../../src/utils/framework-detector.js';
import { runInNewContext } from 'node:vm';

describe('Framework Source Path Normalizer (pure string, no fs)', () => {
  it('terminates on cyclic Vue and React runtime metadata', () => {
    const comp: any = {type:{}}; comp.parent = comp;
    const fiber: any = {type:'div'}; fiber.return = fiber;
    const vue = runInNewContext(IN_BROWSER_COMPONENT_DETECTOR_FN + '\ndetectVueComponent(curr)', {curr:{__vueParentComponent:comp}}, {timeout:100});
    const react = runInNewContext(IN_BROWSER_COMPONENT_DETECTOR_FN + '\ndetectReactComponent(curr)', {curr:{__reactFiber$fixture:fiber}}, {timeout:100});
    assert.equal(vue, null); assert.equal(react, null);
  });
  it('strips Vite /@fs/ prefix while preserving POSIX leading slash', () => {
    const normalized = normalizeSourceFile('/@fs/home/dev/app/src/components/Button.vue?vue&type=script&t=123');
    assert.equal(normalized, '/home/dev/app/src/components/Button.vue');
  });

  it('strips localhost dev-server origin and HMR query strings', () => {
    const normalized = normalizeSourceFile('http://localhost:5173/src/pages/Dashboard.tsx?t=999#top');
    assert.equal(normalized, 'src/pages/Dashboard.tsx');
  });

  it('normalizes Windows Vite /@fs/ drive letters and backslashes', () => {
    const normalized = normalizeSourceFile('/@fs/C:\\Users\\dev\\app\\src\\App.svelte?v=1');
    assert.equal(normalized, 'C:/Users/dev/app/src/App.svelte');
  });

  it('strips leading slash for common project relative roots', () => {
    assert.equal(normalizeSourceFile('/resources/js/Pages/Home.vue'), 'resources/js/Pages/Home.vue');
    assert.equal(normalizeSourceFile('/components/Navbar.tsx'), 'components/Navbar.tsx');
  });

  it('enriches detected framework component without touching disk', () => {
    const enriched = enrichFrameworkComponent({
      framework: 'vue',
      componentName: 'CheckoutCard',
      sourceFile: 'http://localhost:5173/src/components/CheckoutCard.vue?vue&type=template'
    });
    assert.deepEqual(enriched, {
      framework: 'vue',
      componentName: 'CheckoutCard',
      sourceFile: 'src/components/CheckoutCard.vue'
    });
  });

  it('returns undefined when input is missing or empty', () => {
    assert.equal(normalizeSourceFile(undefined), undefined);
    assert.equal(normalizeSourceFile('   '), undefined);
    assert.equal(enrichFrameworkComponent(null), undefined);
  });
});
