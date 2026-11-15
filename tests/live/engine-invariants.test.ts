import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from 'playwright-core';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { PinStore } from '../../src/browser/pin-store.js';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: process.env.SPECTOR_TEST_CHROME || '/usr/bin/google-chrome', headless:true,args:['--no-sandbox'] }); });
afterAll(async () => { await browser?.close(); });

test('ordinary capture waits for emulation cleanup instead of inheriting its viewport', async () => {
  const page = await browser.newPage({viewport:{width:1111,height:777}});
  const manager = new CdpSessionManager(); manager.page = page;
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><button>Target</button>');
  let ready!:()=>void; const started = new Promise<void>(r => ready=r);
  let release!:()=>void; const gate = new Promise<void>(r => release=r);
  const emulation = manager.withBreakpointMetrics(['mobile'], async () => { ready(); await gate; });
  await started;
  let finished = false;
  const capture = manager.runBrowserOperation(() => manager.captureScreenshotBuffer(page)).then(buffer => {finished=true;return buffer;});
  try {
    await new Promise(r => setTimeout(r,50)); expect(finished).toBe(false);
  } finally { release(); await emulation; }
  expect((await capture).readUInt32BE(16)).toBe(1111); await page.close();
});

test('pin store owns snapshots on both insertion and read', () => {
  const store = new PinStore(); const pin = {status:'selected' as const,computedStyles:{color:'blue'}};
  store.add(pin); pin.computedStyles.color='red';
  expect(store.getPins()!.pins[0].computedStyles!.color).toBe('blue');
  store.getPins()!.pins[0].computedStyles!.color='green';
  expect(store.getPins()!.pins[0].computedStyles!.color).toBe('blue');
});

test('consuming an older snapshot preserves pins added after the read', () => {
  const store=new PinStore();store.add({status:'selected',role:'pin',note:'old'});
  const snapshot=store.getPins()!;
  store.add({status:'selected',role:'pin',note:'new'});store.consume(snapshot.pins);
  expect(store.getPins()!.pins.map(pin=>pin.note)).toEqual(['new']);
});

test('same-URL document replacement cannot enrich an old pin with new styles', async () => {
  const page = await browser.newPage(); const manager = new CdpSessionManager(); manager.page=page;
  await page.route('http://pin.test/**', route => route.fulfill({body:'<style>button{background:black}button:hover{background:red}</style><button id="target">New</button>'}));
  await page.goto('http://pin.test/');
  manager.addPin({status:'selected',selector:'#target',targetId:manager.targetId(page),tabUrl:page.url(),computedStyles:{backgroundColor:'blue'}});
  await page.reload();
  const result = (await manager.getLastPicked({includeHoverState:true}))!.pins[0];
  expect(result.hoverState).toBeUndefined();
  expect((result as any).enrichment.hover.status).toBe('stale');
  expect(result.computedStyles!.backgroundColor).toBe('blue'); await page.close();
},15000);
