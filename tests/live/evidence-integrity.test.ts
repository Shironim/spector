import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { extractCompressedDom } from '../../src/analyzers/dom-compressor.js';
import { runTokenAudit } from '../../src/analyzers/token-audit.js';
import { explainCssCascade } from '../../src/analyzers/cdp-styles.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({executablePath:process.env.SPECTOR_TEST_CHROME || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
});
afterAll(async () => { await browser?.close(); });

async function pick(manager: CdpSessionManager, page: Page, role: 'target' | 'reference') {
  manager.page = page;
  const pending = manager.pickElement({role,includeScreenshot:false,includeHoverState:true,timeoutMs:5000});
  await page.locator('[data-spector-picker="toolbar"]').waitFor({ state: 'visible', timeout: 2000 });
  await page.locator('#target').click();
  await page.locator('[data-spector-picker="popover"] input').waitFor({ state: 'visible', timeout: 2000 });
  await page.keyboard.press('Enter');
  return (await pending).pins[0];
}

test('real hover snapshots survive cross-tab comparison but stale active evidence is omitted', async () => {
  const a = await browser.newPage(); const b = await browser.newPage();
  const manager = new CdpSessionManager();
  try {
    await a.setContent('<style>#target{background:black;margin:120px;padding:20px}#target:hover{background:red}</style><button id="target">A</button>');
    await b.setContent('<style>#target{background:black;margin:120px;padding:20px}#target:hover{background:blue}</style><button id="target">B</button>');
    const target = await pick(manager,a,'target');
    const reference = await pick(manager,b,'reference');
    expect(target.hoverState?.changes.backgroundColor.active).toBe('rgb(255, 0, 0)');
    const stored = manager.pins.getPins();
    const crossTab = await manager.getLastPicked({includeHoverState:true});
    expect(crossTab!.pins[0].hoverState).toEqual(target.hoverState);
    expect(crossTab!.comparison?.hoverDiffs?.backgroundColor).toEqual({target:'rgb(255, 0, 0)',reference:'rgb(0, 0, 255)'});
    manager.page = a;
    await a.locator('#target').evaluate(el => { el.outerHTML='<button id="target">Replacement</button>'; });
    const stale = await manager.getLastPicked({includeHoverState:true,includeFocusState:true});
    expect(stale!.pins[0].enrichment?.hover?.status).toBe('stale');
    expect(stale!.pins[0].enrichment?.focus?.status).toBe('stale');
    expect(stale!.pins[0].hoverState).toBeUndefined();
    expect(stale!.pins[0].focusState).toBeUndefined();
    expect(stale!.pins[1].hoverState).toEqual(reference.hoverState);
    expect(stale!.comparison?.hoverDiffs).toBeUndefined();
    expect(manager.pins.getPins()).toEqual(stored);
  } finally { await manager.disconnect(); await a.close(); await b.close(); }
},15000);

test('failed live enrichment cannot fall back to cached hover as current evidence', async () => {
  const page = await browser.newPage(); const manager = new CdpSessionManager();
  try {
    await page.setContent('<style>#target{margin:120px;background:black}#target:hover{background:red}</style><button id="target">A</button>');
    await pick(manager,page,'target');
    const stored = manager.pins.getPins();
    const fault = spyOn(page.context(),'newCDPSession').mockRejectedValue(new Error('CDP unavailable'));
    try {
      const result = await manager.getLastPicked({includeHoverState:true});
      expect(result!.pins[0].enrichment?.hover?.status).toBe('failed');
      expect(result!.pins[0].hoverState).toBeUndefined();
      expect(manager.pins.getPins()).toEqual(stored);
    } finally { fault.mockRestore(); }
  } finally { await manager.disconnect(); await page.close(); }
},10000);

test('DOM traversal crosses boxless/hidden wrappers and preserves whole-document discovery', async () => {
  const page = await browser.newPage({viewport:{width:1000,height:700}});
  try {
    await page.setContent('<div style="display:contents"><button id="contents">Contents</button></div><div style="position:absolute;top:5000px"><button id="fixed" style="position:fixed;top:10px">Fixed</button></div><div style="visibility:hidden"><button id="override" style="visibility:visible">Override</button></div><div style="display:none"><button id="hidden">Hidden</button></div><div style="opacity:0"><button id="transparent">Transparent</button></div><button id="far" style="position:absolute;top:5000px">Far</button>');
    const dom = await extractCompressedDom(page);
    for (const id of ['contents','fixed','override','far']) expect(dom).toContain('#'+id);
    for (const id of ['hidden','transparent']) expect(dom).not.toContain('#'+id);
    expect(dom).toContain('[offscreen]');
    const relaxed = await extractCompressedDom(page,{includeOffscreen:true});
    expect(relaxed).toContain('#transparent'); expect(relaxed).not.toContain('#hidden');
    await page.setContent('<div id="host" style="display:contents"></div>');
    await page.locator('#host').evaluate(el => {el.attachShadow({mode:'open'}).innerHTML='<button id="shadow">Shadow</button>';});
    expect(await extractCompressedDom(page)).toContain('#shadow');
    await page.setContent('<main>'+ '<div style="display:contents">'.repeat(70)+'<button id="deep">Deep</button>'+'</div>'.repeat(70)+'</main>');
    expect(await extractCompressedDom(page)).toContain('DEPTH_LIMIT');
  } finally { await page.close(); }
});

test('token traversal skips hidden subtrees without spending their descendants against the scan cap', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div style="display:none">'+'<span>Hidden</span>'.repeat(350)+'</div><div style="display:contents"><button style="background:rgb(1,2,3)">Visible</button></div>');
    const result = await runTokenAudit(page);
    expect(result).toBeDefined();
    expect(result!.colors.backgrounds.map(b => b.value)).toContain('rgb(1, 2, 3)');
    expect(result!.coverage.skippedHiddenElements).toBeGreaterThanOrEqual(350);
    expect(result!.coverage.limitReached).toBe(false);
    await page.setContent('<button>Visible</button>'.repeat(650));
    const capped = await runTokenAudit(page);
    expect(capped!.coverage.scannedElements).toBe(300);
    expect(capped!.coverage.limitReached).toBe(true);
  } finally { await page.close(); }
});

test('rollback reports observed computed values with partial provenance, including important and inline rollback', async () => {
  const page = await browser.newPage();
  try {
    for (const fixture of [
      {css:'@layer a,b;@layer a{button{color:red}}@layer b{button{color:revert-layer}}',inline:''},
      {css:'@layer a{button{color:red}}button{color:revert-layer}',inline:''},
      {css:'@layer a,b;@layer a{button{color:revert-layer!important}}@layer b{button{color:blue!important}}',inline:''},
      {css:'button{color:red!important}',inline:'color:revert-layer!important'},
      {css:'button{color:revert}',inline:''}
    ]) {
      await page.setContent(`<style>${fixture.css}</style><button style="${fixture.inline}">Target</button>`);
      const actual = await page.locator('button').evaluate(el => getComputedStyle(el).color);
      const report = (await explainCssCascade(page,'button',['color'])).properties.color;
      expect(report.resolution).toBe('partial');
      expect(report.computedValue).toBe(actual);
      expect(report.winningValue).toBeUndefined(); expect(report.winningSource).toBeUndefined();
      expect(report.overridden).toEqual([]);
      expect(report.authoredDeclarations!.length).toBeGreaterThan(0);
    }
    await page.setContent('<style>@layer a,b;@layer a{button{color:red!important}}@layer b{button{color:blue!important}}</style><button>Control</button>');
    const ranked = (await explainCssCascade(page,'button',['color'])).properties.color;
    expect(ranked.resolution).toBe('ranked');
    expect(ranked.winningSource).toContain('layer: a');
    expect(ranked.computedValue).toBe('rgb(255, 0, 0)');
  } finally { await page.close(); }
});
