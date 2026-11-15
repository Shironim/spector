import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from 'playwright-core';
import { runLayoutForensics } from '../../src/analyzers/layout-forensics.js';
import { extractDesignTokens } from '../../src/analyzers/token-extractor.js';
import { extractCompressedDom } from '../../src/analyzers/dom-compressor.js';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { OVERLAY_ENGINE_SCRIPT } from '../../src/browser/overlay-script.js';

let browser: Browser;
beforeAll(async()=>{browser=await chromium.launch({executablePath:process.env.SPECTOR_TEST_CHROME||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});});
afterAll(async()=>{await browser?.close();});

test('analyzers expose omitted candidates instead of implying full-page coverage',async()=>{
 const page=await browser.newPage();
 try{
  await page.setContent('<main>'+Array.from({length:650},(_,i)=>`<div>Item ${i}</div>`).join('')+'</main>');
  const layout:any=await runLayoutForensics(page);const tokens:any=await extractDesignTokens(page);
  expect(layout.coverage.visitedElements).toBe(600);expect(layout.coverage.elementLimitReached).toBe(true);
  expect(tokens.coverage.visitedElements).toBe(300);expect(tokens.coverage.elementLimitReached).toBe(true);
  expect(layout.coverage.scope).toBe('document-light-dom');
 }finally{await page.close();}
});

test('DOM depth and node limits are visible in the returned context',async()=>{
 const page=await browser.newPage();
 try{
  await page.setContent('<main id="root"><section class="deep"><p>Beyond requested depth</p></section></main>');
  const shallow=await extractCompressedDom(page,{selector:'#root',maxDepth:0});
  expect(shallow).toContain('DEPTH_LIMIT');
  await page.setContent(Array.from({length:1200},(_,i)=>`<button>${i}</button>`).join(''));
  expect(await extractCompressedDom(page)).toContain('NODE_LIMIT');
 }finally{await page.close();}
});

test('finding and variable caps are distinct from element coverage',async()=>{
 const page=await browser.newPage();
 try{
  await page.setContent('<style>:root{'+Array.from({length:60},(_,i)=>`--value-${i}:${i}px;`).join('')+'}</style>'+Array.from({length:20},()=>'<div style="width:10px;overflow:hidden;white-space:nowrap">Clipped contents</div>').join(''));
  const layout:any=await runLayoutForensics(page);expect(layout.coverage.elementLimitReached).toBe(false);
  expect(layout.coverage.categoriesAtLimit).toContain('clippingTraps');
  const tokens:any=await extractDesignTokens(page);expect(tokens.coverage.variablesAtLimit).toBe(true);
  const without:any=await extractDesignTokens(page,{includeVariables:false});expect(without.coverage.variablesRequested).toBe(false);expect(without.coverage.variablesAtLimit).toBe(false);
  await page.setContent(Array.from({length:900},()=>`<button aria-label="${'x'.repeat(150)}">Target</button>`).join(''));
  const dom=await extractCompressedDom(page);expect(dom).toContain('CHAR_LIMIT');expect(dom.length).toBeLessThan(65000);
 }finally{await page.close();}
});

test('large screenshots are rejected before capture and the page remains usable',async()=>{
 const page=await browser.newPage();const manager=new CdpSessionManager();manager.page=page;
 try{
  await page.setContent('<main style="height:50000px">Huge page</main>');
  await expect(manager.captureScreenshotBuffer(page,{fullPage:true})).rejects.toMatchObject({code:'RESOURCE_LIMIT_EXCEEDED'});
  expect((await manager.captureScreenshotBuffer(page)).length).toBeGreaterThan(100);
 }finally{await page.close();}
});

test('deadline retains render ownership and navigation tracking until cleanup',async()=>{
 const page=await browser.newPage({viewport:{width:1111,height:777}});const manager=new CdpSessionManager();manager.page=page;
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 let ready!:()=>void;const started=new Promise<void>(r=>ready=r);
 try{
  await page.route('http://deadline.test/**',route=>route.fulfill({body:'<div style="height:3000px">Page</div>'}));
  await page.goto('http://deadline.test/');
  const operation=manager.runBrowserOperation(()=>manager.withBreakpointMetrics(['mobile'],async()=>{ready();await gate;}),false,250);
  const timedOut=operation.catch(error=>error);
  await started;expect((await timedOut).code).toBe('OPERATION_TIMEOUT');
  await page.reload();await page.evaluate(()=>scrollTo(0,120));
  let captured=false;const capture=manager.captureScreenshotBuffer(page).then(buffer=>{captured=true;return buffer;});
  await new Promise(r=>setTimeout(r,20));expect(captured).toBe(false);release();
  expect((await capture).readUInt32BE(16)).toBe(1111);expect(await page.evaluate(()=>scrollY)).toBe(120);
 }finally{release?.();await page.close();}
},15000);

test('picker queue prevents an eleventh selection instead of losing the accepted batch',async()=>{
 const page=await browser.newPage();const manager=new CdpSessionManager();manager.page=page;
 try{
  await page.setContent('<button id="target" style="margin:100px;padding:20px">Target</button>');
  const pending=manager.pickElement({role:'pin',includeScreenshot:false,timeoutMs:10000});
  pending.catch(()=>{});
  await page.getByRole('button',{name:'Queue',exact:true}).waitFor({state:'visible',timeout:2000});
  for(let i=0;i<11;i++)await page.locator('#target').click();
  expect(await page.getByText('Queue is full. Send these pins before adding more.',{exact:true}).isVisible()).toBe(true);
  await page.getByRole('button',{name:'Send (10)',exact:true}).click();
  expect((await pending).pins).toHaveLength(10);
 }finally{await page.close();}
},15000);

test('hotkey binding failures show failure instead of a success toast',async()=>{
 const page=await browser.newPage({viewport:{width:375,height:812}});
 try{
  await page.setContent('<button id="target" style="position:absolute;top:400px;left:24px;padding:20px">Target</button>');
  await page.exposeFunction('__spector_on_element_picked',async()=>{throw new Error('Rejected payload');});
  await page.evaluate(OVERLAY_ENGINE_SCRIPT);
  const pending=page.evaluate(()=>(window as any).__spectorOverlay.start({source:'hotkey',timeoutMs:5000}));
  pending.catch(()=>{});
  await page.getByRole('toolbar',{name:'Spector element picker'}).waitFor({state:'visible',timeout:1500});
  await page.locator('#target').click({timeout:1500});
  expect((await pending).status).toBe('cancelled');
  expect(await page.getByText('Spector could not collect this selection. Pick it again.',{exact:true}).isVisible()).toBe(true);
  const box=await page.getByText('Spector could not collect this selection. Pick it again.',{exact:true}).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(375);
  await page.screenshot({path:'/tmp/spector-picker-failure-mobile.png'});
 }finally{await page.close();}
},10000);

test('coverage extraction and validated picker work on a strict-CSP page',async()=>{
 const page=await browser.newPage();const manager=new CdpSessionManager();manager.page=page;
 try{
  await page.route('http://csp.test/**',route=>route.fulfill({headers:{'content-security-policy':"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'",'content-type':'text/html'},body:'<button id="target" style="margin:100px;padding:20px">CSP Target</button>'}));
  await page.goto('http://csp.test/');
  expect(await extractCompressedDom(page)).toContain('CSP Target');
  expect((await runLayoutForensics(page)).coverage!.scope).toBe('document-light-dom');
  const pending=manager.pickElement({includeScreenshot:true,timeoutMs:5000});pending.catch(()=>{});
  await page.getByRole('toolbar',{name:'Spector element picker'}).waitFor({state:'visible',timeout:1500});
  await page.locator('#target').click();const result=await pending;
  expect(result.status).toBe('selected');expect(result.pins[0].sections!.screenshot!.status).toBe('captured');
 }finally{await page.close();}
},15000);
