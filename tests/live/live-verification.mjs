import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright-core';
import { escapeTailwindSelector } from '../../src/utils/selector.ts';
import { normalizeSourceFile } from '../../src/utils/framework-detector.ts';
import { TIMEOUTS, TOKEN_BUDGETS, VIEWPORT_PRESETS } from '../../src/constants.ts';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distEntry = path.join(repoRoot, 'dist', 'index.js');

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const blue = (s) => `\x1b[34m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

let passed = 0;
let failed = 0;

function report(id, title, ok, details = '') {
  if (ok) {
    passed++;
    console.log(`[PASS] ${id} - ${title}${details ? ` (${details})` : ''}`);
  } else {
    failed++;
    console.error(`[FAIL] ${id} - ${title}${details ? ` -> ${details}` : ''}`);
  }
}

async function run() {
  console.log(bold('\n======================================================'));
  console.log(bold('  SPECTOR v2 E2E & LIVE PROTOCOL VERIFICATION SUITE   '));
  console.log(bold('======================================================\n'));

  console.log(blue('>>> Phase 1: Engine Invariants & Utility Verification'));

  const twSelectors = [
    { input: '.w-[200px]', expected: '.w-\\[200px\\]' },
    { input: '.h-[50vh]', expected: '.h-\\[50vh\\]' },
    { input: '.top-[1.5rem]', expected: '.top-\\[1\\.5rem\\]' },
    { input: '.w-[50%]', expected: '.w-\\[50\\%\\]' },
    { input: '.w-1/2', expected: '.w-1\\/2' },
    { input: '.p-1.5', expected: '.p-1\\.5' },
    { input: '.hover:bg-blue-500', expected: '.hover\\:bg-blue-500' },
    { input: '.item:nth-of-type(2)', expected: '.item:nth-of-type(2)' }
  ];

  for (const { input, expected } of twSelectors) {
    const res = escapeTailwindSelector(input);
    report('TW-ESCAPE', `Escapes ${input}`, res === expected, `Got: ${res}`);
  }

  const normalizedVite = normalizeSourceFile('/@fs' + process.cwd() + '/src/App.vue?vue&type=script');
  report(
    'NORMALIZER-01',
    'Strips Vite /@fs/ and HMR query without fs',
    normalizedVite === process.cwd() + '/src/App.vue',
    normalizedVite
  );

  const okConstants =
    TIMEOUTS.CDP_CONNECT_MS === 10000 &&
    TOKEN_BUDGETS.MAX_INLINE_SVG_BYTES === 2048 &&
    VIEWPORT_PRESETS.mobile.width === 375 &&
    VIEWPORT_PRESETS.desktop.width === 1440;
  report('CONSTANTS-01', 'v2 constants centralized in src/constants.ts', okConstants);

  console.log(blue('\n>>> Phase 2: Starting Local Test Server for Browser Navigation'));

  const server = http.createServer((req, res) => {
    const reqPath = (req.url || '/').split('?')[0];
    if (reqPath === '/test-page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Spector v2 Test Fixture</title>
  <style>
    :root {
      --brand-accent: #2563eb;
      --surface-bg: #f8fafc;
    }
    body { font-family: Inter, sans-serif; padding: 20px; margin: 0; background: var(--surface-bg); color: #0f172a; }
    .btn { padding: 8px 16px; color: #ffffff; background-color: #334155; border-radius: 8px; }
    .btn-primary { padding: 12px 24px; background-color: var(--brand-accent); }
    .btn-primary:hover { background-color: #1d4ed8; }
    #cascade-target { margin-top: 72px; }
    #overflow-culprit { width: 2200px; height: 24px; background: #fee2e2; }
    #clip-ancestor { overflow: hidden; height: 80px; }
    #sticky-inside-clip { position: sticky; top: 0; }
  </style>
</head>
<body>
  <h1 id="heading">Spector v2 Automated Verification Page</h1>

  <button id="btn-arbitrary" class="w-[200px] top-[1.5rem] px-4 py-2 bg-blue-600 text-white rounded-lg" onclick="this.textContent='Arbitrary Clicked'">Click Arbitrary</button>
  <button id="btn-fraction" class="w-1/2 p-1.5" onclick="this.textContent='Fraction Clicked'">Click Fraction</button>
  <button id="cascade-target" class="btn btn-primary" style="border-radius: 12px;">Cascade Target</button>

  <div id="overflow-culprit">Overflow Culprit</div>
  <div id="clip-ancestor">
    <div id="sticky-inside-clip">Sticky Trapped</div>
  </div>
  <img id="broken-img" src="/missing-asset.png?secret=IMG_SECRET" width="64" height="64" alt="Broken test asset" />

  <script>
    console.log('Test page loaded successfully');
    console.error('Fixture diagnostic error');
    fetch('/api/broken?token=LIVE_SECRET').catch(() => {});
  </script>
</body>
</html>`);
    } else if (reqPath === '/other-page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><head><title>Other Route</title></head><body><h1>Different Page</h1></body></html>');
    } else if (reqPath === '/api/broken') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"internal_failure"}');
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise((resolve) => server.listen(8765, resolve));
  const testUrl = 'http://localhost:8765/test-page';
  console.log(`Local test fixture available at ${testUrl}`);

  console.log(blue('\n>>> Phase 3: Launching Spector v2 Server over MCP Stdio Transport'));

  const transport = new StdioClientTransport({
    command: 'node',
    args: [distEntry]
  });

  const client = new Client({ name: 'spector-verifier', version: '2.0.0' }, { capabilities: {} });
  await client.connect(transport);
  let observationBrowser;

  try {
    const attachRes = await client.callTool({
      name: 'spector_attach',
      arguments: { cdpUrl: 'http://localhost:9222', autoSelectActiveTab: true }
    });
    const attachJson = JSON.parse(attachRes.content[0].text);
    const attachSuccess = attachJson.status === 'connected' || Boolean(attachJson.activeTab?.url);
    report('ATTACH-01', 'Attaches to Chrome CDP 9222', attachSuccess, attachJson.activeTab?.title || attachJson.status);

    const navRes = await client.callTool({
      name: 'spector_navigate',
      arguments: { url: testUrl, waitUntil: 'networkidle' }
    });
    const navJson = JSON.parse(navRes.content[0].text);
    report('NAV-01', 'Navigates to local test fixture', navJson.url === testUrl);

    const tabsRes = await client.callTool({ name: 'spector_tabs', arguments: { action: 'list' } });
    const tabsJson = JSON.parse(tabsRes.content[0].text);
    report('TABS-01', 'Lists active browser tabs', Array.isArray(tabsJson) && tabsJson.length > 0, `${tabsJson.length} tabs`);

    const selectRes = await client.callTool({
      name: 'spector_tabs',
      arguments: { action: 'select', url: '*8765*', title: 'Spector v2 Test Fixture' }
    });
    const selectJson = JSON.parse(selectRes.content[0].text);
    observationBrowser = await chromium.connectOverCDP('http://localhost:9222');
    const observedPage = observationBrowser.contexts()[0].pages().find(page => page.url() === testUrl);
    if (!observedPage) throw new Error('Cannot locate fixture page for independent viewport observation.');
    const readRenderMetrics = () => observedPage.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    const initialViewport = await readRenderMetrics();
    report('TAB-SELECT-01', 'Selects tab via URL glob wildcard', (selectJson.activeTab?.url || '').includes('8765'));
    report(
      'TAB-SELECT-02',
      'Returns warning on multiple tab selection criteria',
      Boolean(selectJson.warning && selectJson.warning.includes('Multiple tab selection criteria'))
    );

    const domRes = await client.callTool({
      name: 'spector_get_dom_tree',
      arguments: { maxDepth: 4 }
    });
    const domText = domRes.content[0].text;
    report('DOM-TREE-01', 'Extracts compressed DOM tree', domText.includes('Spector v2 Automated Verification Page'));
    report('DOM-TREE-02', 'Preserves >3 Tailwind classes and omits loc="..."', domText.includes('.rounded-lg') && !domText.includes('loc="'));

    const twClickRes = await client.callTool({
      name: 'spector_interact',
      arguments: { action: 'click', selector: '.w-[200px]' }
    });
    report('INTERACT-01', 'Clicks element via arbitrary Tailwind selector .w-[200px]', JSON.parse(twClickRes.content[0].text).success === true);

    const twFracClickRes = await client.callTool({
      name: 'spector_interact',
      arguments: { action: 'click', selector: '.w-1/2.p-1.5' }
    });
    report('INTERACT-02', 'Clicks element via fraction & decimal selector .w-1/2.p-1.5', JSON.parse(twFracClickRes.content[0].text).success === true);

    const hoverRes = await client.callTool({
      name: 'spector_interact',
      arguments: { action: 'hover', selector: '#cascade-target' }
    });
    report('INTERACT-03', 'Dispatches hover state interaction', JSON.parse(hoverRes.content[0].text).success === true);

    const scrollIntoViewRes = await client.callTool({
      name: 'spector_interact',
      arguments: { action: 'scrollIntoView', selector: '#heading', waitForTimeoutMs: 50 }
    });
    report('INTERACT-04', 'Dispatches scrollIntoView with waitForTimeoutMs', JSON.parse(scrollIntoViewRes.content[0].text).success === true);

    const hScrollRes = await client.callTool({
      name: 'spector_interact',
      arguments: { action: 'scroll', scrollDelta: { x: 100 } }
    });
    report('INTERACT-05', 'Dispatches horizontal scroll delta', JSON.parse(hScrollRes.content[0].text).success === true);

    const tokensRes = await client.callTool({
      name: 'spector_extract_tokens',
      arguments: {}
    });
    const tokensJson = JSON.parse(tokensRes.content[0].text);
    report(
      'TOKENS-01',
      'Extracts :root CSS variables, palette, typography scale, and radii',
      Boolean(tokensJson.cssVariables?.['--brand-accent'] && tokensJson.typography?.scale?.length > 0 && tokensJson.radii?.length > 0)
    );

    const diagRes = await client.callTool({
      name: 'spector_diagnose',
      arguments: {
        selector: '#cascade-target',
        breakpoints: ['mobile', 'desktop'],
        consoleLevel: 'all',
        clearLogs: true
      }
    });
    const diagRaw = diagRes.content[0].text;
    const diagJson = JSON.parse(diagRaw);

    const hasConsoleErr = diagJson.runtimeHealth?.consoleErrors?.some((e) => e.text.includes('Fixture diagnostic error'));
    const hasFailedApi = diagJson.runtimeHealth?.failedNetwork?.some((n) => n.pathname === '/api/broken' && n.status === 500);
    const leakedSecret = diagRaw.includes('LIVE_SECRET') || diagRaw.includes('IMG_SECRET');
    report(
      'DIAGNOSE-01',
      'Captures console errors and >=400 failed network pathname-only without secrets',
      Boolean(hasConsoleErr && hasFailedApi && !leakedSecret),
      `console=${diagJson.runtimeHealth?.consoleErrors?.length}, net=${JSON.stringify(diagJson.runtimeHealth?.failedNetwork)}, leaked=${leakedSecret}`
    );

    const hasOverflowCulprit = diagJson.layoutForensics?.horizontalOverflow?.culprits?.some((c) => c.selector === '#overflow-culprit');
    const hasStickyTrap = diagJson.layoutForensics?.clippingTraps?.some((t) => t.selector === '#sticky-inside-clip');
    const hasBrokenImg = diagJson.layoutForensics?.brokenMedia?.some((m) => m.selector === '#broken-img');
    report('DIAGNOSE-02', 'Detects overflow culprit, sticky trap, and broken image', Boolean(hasOverflowCulprit && hasStickyTrap && hasBrokenImg));

    const hasCascade = Boolean(diagJson.cssCascade?.properties?.padding?.winningValue);
    report('DIAGNOSE-03', 'Explains CSS cascade winning rules via CDP', hasCascade);

    const hasBreakpoints = diagJson.breakpointAudits?.length === 2 && diagJson.breakpointAudits[0].width === 375;
    report('DIAGNOSE-04', 'Audits multi-breakpoint horizontal overflow', Boolean(hasBreakpoints));

    const postViewport = await readRenderMetrics();
    report(
      'VIEWPORT-RESTORE-01',
      'Restores viewport metrics after breakpoint audit',
      JSON.stringify(postViewport) === JSON.stringify(initialViewport),
      `Before=${JSON.stringify(initialViewport)}, After=${JSON.stringify(postViewport)}`
    );

    const screenshotRes = await client.callTool({
      name: 'spector_capture_screenshot',
      arguments: { selector: '.w-[200px]' }
    });
    report('SCREENSHOT-01', 'Captures screenshot using arbitrary Tailwind selector', screenshotRes.content?.some((c) => c.type === 'image' && c.data));

    const bpScreenRes = await client.callTool({
      name: 'spector_capture_screenshot',
      arguments: { breakpoints: ['mobile', 'desktop'] }
    });
    const bpImages = bpScreenRes.content?.filter((c) => c.type === 'image') || [];
    report('SCREENSHOT-02', 'Captures multi-breakpoint screenshots (mobile & desktop)', bpImages.length === 2);

    const applyCssRes = await client.callTool({
      name: 'spector_preview_css',
      arguments: { action: 'apply', css: '#heading { color: rgb(220, 38, 38); }' }
    });
    const clearCssRes = await client.callTool({
      name: 'spector_preview_css',
      arguments: { action: 'clear' }
    });
    report(
      'PREVIEW-01',
      'Applies and clears ephemeral CSS preview stylesheet',
      JSON.parse(applyCssRes.content[0].text).success && JSON.parse(clearCssRes.content[0].text).success
    );

    const lastPickedRes = await client.callTool({
      name: 'spector_picker',
      arguments: { action: 'get' }
    });
    report(
      'PICKER-01',
      'Get last picked returns fail-safe guidance when unselected',
      lastPickedRes.content[0].text.includes('NO_PICKED_ELEMENT')
    );

    const pickPromise = client.callTool({
      name: 'spector_picker',
      arguments: { action: 'pick', timeoutMs: 8000, includeHoverState: true, role: 'target' }
    });
    await new Promise((r) => setTimeout(r, 250));
    await client.callTool({
      name: 'spector_interact',
      arguments: { action: 'hover', selector: '#cascade-target' }
    });
    await client.callTool({
      name: 'spector_interact',
      arguments: { action: 'click', selector: '#cascade-target' }
    });
    const pickedRes = await pickPromise;
    const pickedJson = JSON.parse(pickedRes.content[0].text);
    const hasBlueprintStyles = Boolean(pickedJson.computedStyles?.fontFamily && pickedJson.computedStyles?.fontSize && pickedJson.computedStyles?.lineHeight);
    const hasHoverDelta = Boolean(pickedJson.hoverState?.changes?.backgroundColor);
    const hasBlueprintScreenshot = pickedRes.content?.some((c) => c.type === 'image' && c.data);
    report(
      'PICKER-02',
      'Captures Design Blueprint with full typography, :hover CDP delta, and screenshot',
      Boolean(pickedJson.status === 'selected' && hasBlueprintStyles && hasHoverDelta && hasBlueprintScreenshot),
      `selector=${pickedJson.selector}, hover=${JSON.stringify(pickedJson.hoverState?.changes?.backgroundColor)}`
    );

    const clearPinRes = await client.callTool({
      name: 'spector_picker',
      arguments: { action: 'clear' }
    });
    report('PICKER-03', 'Clears pin queue cleanly via action=clear', JSON.parse(clearPinRes.content[0].text).data?.cleared === 1);
  } finally {
    console.log(blue('\n>>> Phase 4: Disconnecting MCP Client & Verifying Chrome Survival'));
    await observationBrowser?.close();
    await client.close();
    server.close();

    await new Promise((r) => setTimeout(r, 500));
    try {
      const ping = await fetch('http://localhost:9222/json/version');
      const pingJson = await ping.json();
      report('SURVIVAL-01', 'Physical Chrome process survived spector disconnection', Boolean(pingJson.Browser), pingJson.Browser);
    } catch (e) {
      report('SURVIVAL-01', 'Physical Chrome process survived spector disconnection', false, e.message);
    }
  }

  console.log(bold('\n======================================================'));
  console.log(bold(`  TEST RESULTS: ${green(`${passed} PASSED`)} | ${failed > 0 ? red(`${failed} FAILED`) : '0 FAILED'}`));
  console.log(bold('======================================================\n'));

  if (failed > 0) {
    process.exit(1);
  }
}

const isSyntaxCheck =
  process.execArgv.includes('--check') ||
  process.execArgv.includes('-c') ||
  process.argv.includes('--check') ||
  process.argv.includes('-c');

if (!isSyntaxCheck) {
  run().catch((err) => {
    console.error(red('Fatal error during test run:'), err);
    process.exit(1);
  });
}
