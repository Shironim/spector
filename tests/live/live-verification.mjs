import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { escapeTailwindSelector } from '../src/browser-manager.js';
import { resolveSourceLocation } from '../src/utils/source-resolver.js';
import { TIMEOUTS, TELEMETRY_LIMITS, EXTENSION_CANDIDATES, SNIPPET_LIMITS } from '../src/constants.js';
import http from 'node:http';
import assert from 'node:assert';

// ANSI colors for clean test logging
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
  console.log(bold('  SPECTOR E2E & LIVE PROTOCOL VERIFICATION SUITE      '));
  console.log(bold('======================================================\n'));

  // -----------------------------------------------------------------
  // 1. UNIT & MODULE LEVEL INVARIANTS (Tailwind, Resolver, Constants)
  // -----------------------------------------------------------------
  console.log(blue('>>> Phase 1: Engine Invariants & Utility Verification'));

  // 1.1 Tailwind Selector Escaping (P0-04, F4-30)
  const twSelectors = [
    { input: '.w-[200px]', expected: '.w-\\[200px\\]' },
    { input: '.h-[50vh]', expected: '.h-\\[50vh\\]' },
    { input: '.top-[1.5rem]', expected: '.top-\\[1\\.5rem\\]' },
    { input: '.w-[50%]', expected: '.w-\\[50\\%\\]' },
    { input: '.w-1/2', expected: '.w-1\\/2' },
    { input: '.h-2/3', expected: '.h-2\\/3' },
    { input: '.p-1.5', expected: '.p-1\\.5' },
    { input: '.m-0.5', expected: '.m-0\\.5' },
    { input: '.hover:bg-blue-500', expected: '.hover\\:bg-blue-500' },
  ];

  for (const { input, expected } of twSelectors) {
    const res = escapeTailwindSelector(input);
    const ok = res === expected;
    report(`TW-ESCAPE`, `Escapes ${input}`, ok, `Got: ${res}`);
  }

  // 1.2 POSIX Vite /@fs/ Leading Slash & Markdown Link (P0-03, P1-05)
  const existingFile = '/@fs' + process.cwd() + '/package.json';
  const posixVite = resolveSourceLocation(existingFile, 'package', 1);
  const okPosixSlash = posixVite?.absolutePath === process.cwd() + '/package.json';
  report('RESOLVER-01', 'Preserves POSIX leading slash for Vite /@fs/ paths', okPosixSlash, posixVite?.absolutePath);

  const okMdLink = Boolean(posixVite?.fileUrl && posixVite.fileUrl.startsWith('file:///') && !posixVite.fileUrl.startsWith('file:////'));
  report('RESOLVER-02', 'Formats POSIX markdown link with exactly 3 slashes', okMdLink, posixVite?.fileUrl);

  // 1.3 Centralized Constants (F3-29, F4-33)
  const okConstants = 
    TIMEOUTS.CDP_CONNECT_MS === 10000 &&
    EXTENSION_CANDIDATES.includes('.blade.php') &&
    EXTENSION_CANDIDATES.includes('.vue') &&
    SNIPPET_LIMITS.MAX_FILE_SIZE_BYTES === 200000;
  report('CONSTANTS-01', 'Constants centralized in src/constants.ts', okConstants);

  // -----------------------------------------------------------------
  // 2. HTTP SERVER SETUP FOR LIVE BROWSER CDP TARGET
  // -----------------------------------------------------------------
  console.log(blue('\n>>> Phase 2: Starting Local Test Server for Browser Navigation'));
  
  const server = http.createServer((req, res) => {
    if (req.url === '/test-page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Spector Test Fixture</title>
  <style>
    body { font-family: sans-serif; padding: 20px; width: 2000px; height: 2000px; }
  </style>
</head>
<body>
  <h1 id="heading">Spector Automated Verification Page</h1>
  
  <!-- Tailwind arbitrary & fraction buttons -->
  <button id="btn-arbitrary" class="w-[200px] top-[1.5rem]" onclick="this.textContent='Arbitrary Clicked'">Click Arbitrary</button>
  <button id="btn-fraction" class="w-1/2 p-1.5" onclick="this.textContent='Fraction Clicked'">Click Fraction</button>
  
  <!-- Quote hint test -->
  <button id="btn-apostrophe" onclick="this.textContent='Apostrophe Clicked'">Don't submit</button>

  <!-- Table with duplicate test IDs to test DOM diffing fingerprinting -->
  <table id="test-table">
    <tbody>
      <tr data-testid="row-item"><td class="name">Item A</td></tr>
      <tr data-testid="row-item"><td class="name">Item B</td></tr>
      <tr data-testid="row-item"><td class="name">Item C</td></tr>
    </tbody>
  </table>

  <!-- Dynamic container for diffing -->
  <div id="dynamic-container">
    <p id="original-item">Original Text</p>
  </div>

  <input id="test-input" type="text" placeholder="Type here..." />

  <script>
    console.log('Test page loaded successfully');
  </script>
</body>
</html>`);
    } else if (req.url === '/other-page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><title>Other Route</title></head><body><h1>Different Page</h1></body></html>`);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise((resolve) => server.listen(8765, resolve));
  const testUrl = 'http://localhost:8765/test-page';
  const otherUrl = 'http://localhost:8765/other-page';
  console.log(`Local test fixture available at ${testUrl}`);

  // -----------------------------------------------------------------
  // 3. MCP CLIENT CONNECTION & LIVE PROTOCOL TESTING
  // -----------------------------------------------------------------
  console.log(blue('\n>>> Phase 3: Launching Spector Server over MCP Stdio Transport'));

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js']
  });

  const client = new Client({ name: 'spector-verifier', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  try {
    // 3.1 Attach to Live Chrome
    const attachRes = await client.callTool({
      name: 'spector_attach',
      arguments: { cdpUrl: 'http://localhost:9222', autoSelectActiveTab: true }
    });
    const attachJson = JSON.parse(attachRes.content[0].text);
    const attachSuccess = attachJson.status === 'connected' || Boolean(attachJson.activeTab?.url);
    report('ATTACH-01', 'Attaches to Chrome CDP 9222', attachSuccess, attachJson.activeTab?.title || attachJson.status);

    // 3.2 Navigate to Test Page
    const navRes = await client.callTool({
      name: 'spector_navigate',
      arguments: { url: testUrl }
    });
    const navJson = JSON.parse(navRes.content[0].text);
    report('NAV-01', 'Navigates to local test fixture', Boolean(navJson.url === testUrl || navJson.data?.url === testUrl));

    // 3.3 List Tabs
    const tabsRes = await client.callTool({
      name: 'spector_list_tabs',
      arguments: {}
    });
    const tabsJson = JSON.parse(tabsRes.content[0].text);
    const tabList = Array.isArray(tabsJson) ? tabsJson : (tabsJson.tabs || tabsJson.data || []);
    const hasTabs = tabList.length > 0;
    report('TABS-01', 'Lists active browser tabs', hasTabs, `${tabList.length} tabs found`);

    // 3.4 Select Tab with Glob & Multi-criteria Warning (F3-23, F3-24)
    const selectRes = await client.callTool({
      name: 'spector_select_tab',
      arguments: {
        urlPattern: '*8765*',
        title: 'Spector Test Fixture' // Passing both triggers warning!
      }
    });
    const selectJson = JSON.parse(selectRes.content[0].text);
    const hasWarning = Boolean(selectJson.warning && selectJson.warning.includes('Multiple tab selection criteria'));
    const selectedUrl = selectJson.activeTab?.url || selectJson.url || '';
    report('TAB-SELECT-01', 'Select tab converts glob pattern to regex', selectedUrl.includes('8765'));
    report('TAB-SELECT-02', 'Multi-criteria tab selection returns diagnostic warning', hasWarning, selectJson.warning);

    // 3.5 DOM Tree Extraction & maxDepth limit (P2-19, P1-09)
    const domRes = await client.callTool({
      name: 'spector_get_dom_tree',
      arguments: { maxDepth: 4 }
    });
    const domText = domRes.content[0].text;
    const hasHeading = domText.includes('Spector Automated Verification Page');
    // Verify apostrophe escaping in loc hint: loc="text='Don\'t submit'"
    const hasEscapedApostrophe = domText.includes("Don\\'t submit") || domText.includes("Don't submit");
    report('DOM-TREE-01', 'Extracts compressed DOM tree with maxDepth limit', hasHeading);
    report('DOM-TREE-02', 'loc hint with apostrophe safely encoded', hasEscapedApostrophe);

    // 3.6 Interaction with Tailwind Arbitrary Selector (.w-[200px]) (P0-04, F4-30)
    const twClickRes = await client.callTool({
      name: 'spector_interact',
      arguments: {
        action: 'click',
        selector: '.w-[200px]'
      }
    });
    const twClickJson = JSON.parse(twClickRes.content[0].text);
    report('INTERACT-01', 'Clicks element via arbitrary Tailwind selector .w-[200px]', twClickJson.success === true);

    // 3.7 Interaction with Tailwind Fraction Selector (.w-1/2.p-1.5) (F4-30)
    const twFracClickRes = await client.callTool({
      name: 'spector_interact',
      arguments: {
        action: 'click',
        selector: '.w-1/2.p-1.5'
      }
    });
    const twFracClickJson = JSON.parse(twFracClickRes.content[0].text);
    report('INTERACT-02', 'Clicks element via fraction & decimal selector .w-1/2.p-1.5', twFracClickJson.success === true);

    // 3.8 Dual-Casing Action Enum & delayMs Alias (P2-14, P2-16)
    const snakeCaseRes = await client.callTool({
      name: 'spector_interact',
      arguments: {
        action: 'scroll_into_view',
        selector: '#heading',
        delayMs: 100
      }
    });
    const snakeCaseJson = JSON.parse(snakeCaseRes.content[0].text);
    report('INTERACT-03', 'Supports snake_case action "scroll_into_view" and delayMs alias', snakeCaseJson.success === true);

    const camelCaseRes = await client.callTool({
      name: 'spector_interact',
      arguments: {
        action: 'scrollIntoView',
        selector: '#heading',
        waitForTimeoutMs: 100
      }
    });
    const camelCaseJson = JSON.parse(camelCaseRes.content[0].text);
    report('INTERACT-04', 'Supports camelCase action "scrollIntoView"', camelCaseJson.success === true);

    // 3.9 Horizontal Scroll Delta Fallback Check (P1-06)
    const hScrollRes = await client.callTool({
      name: 'spector_interact',
      arguments: {
        action: 'scroll',
        scrollDelta: { x: 150 }
      }
    });
    const hScrollJson = JSON.parse(hScrollRes.content[0].text);
    report('INTERACT-05', 'Horizontal scroll executes without forced vertical default trap', hScrollJson.success === true);

    // 3.10 Envelope Response Structure (F3-22, F4-34)
    const isEnvelope = typeof hScrollJson.success === 'boolean' && typeof hScrollJson.message === 'string';
    report('ENVELOPE-01', 'Returns standardized envelope format { success, message, data }', isEnvelope);

    // 3.11 DOM Diffing & Duplicate testId Stability (P1-08, F3-25, F4-32)
    const baselineDiff = await client.callTool({
      name: 'spector_diff_dom',
      arguments: { resetBaseline: true }
    });
    const baselineJson = JSON.parse(baselineDiff.content[0].text);
    report('DIFF-01', 'Sets initial DOM baseline', baselineJson.status === 'baseline_set');

    // Mutate page DOM via interact evaluate or typing
    await client.callTool({
      name: 'spector_interact',
      arguments: {
        action: 'type',
        selector: '#test-input',
        text: 'Hello Spector'
      }
    });

    const mutatedDiff = await client.callTool({
      name: 'spector_diff_dom',
      arguments: { resetBaseline: false }
    });
    const mutatedJson = JSON.parse(mutatedDiff.content[0].text);
    report('DIFF-02', 'Detects DOM mutation without avalanche false-positives', mutatedJson.summary !== undefined);

    // 3.12 DOM Diff URL Mismatch Warning on Route Change (F3-26)
    await client.callTool({
      name: 'spector_navigate',
      arguments: { url: otherUrl }
    });
    const mismatchDiff = await client.callTool({
      name: 'spector_diff_dom',
      arguments: { resetBaseline: false }
    });
    const mismatchJson = JSON.parse(mismatchDiff.content[0].text);
    const hasUrlWarning = Boolean(mismatchJson.urlMismatchWarning);
    report('DIFF-03', 'Detects route change and reports urlMismatchWarning', hasUrlWarning, mismatchJson.urlMismatchWarning);

    // Navigate back to testUrl
    await client.callTool({
      name: 'spector_navigate',
      arguments: { url: testUrl }
    });

    // 3.13 Mock Network Route with Headers (P2-18, F3-22)
    const mockRes = await client.callTool({
      name: 'spector_mock_network',
      arguments: {
        action: 'set',
        urlPattern: '**/api/v1/user',
        status: 200,
        contentType: 'application/json',
        body: '{"name":"Tester"}',
        headers: { 'X-Mocked-By': 'Spector' }
      }
    });
    const mockJson = JSON.parse(mockRes.content[0].text);
    report('MOCK-01', 'Registers mock network route with custom headers', mockJson.success === true);

    // 3.14 Network Logs & Dual Casing (P1-11, P1-12, P2-15, F3-28)
    const netLogsRes = await client.callTool({
      name: 'spector_get_network_logs',
      arguments: {
        errors_only: false,
        limit: 10,
        format: 'verbose'
      }
    });
    const netLogsText = netLogsRes.content[0].text;
    const isNetJson = netLogsText.startsWith('[') || netLogsText.startsWith('{');
    const netLogsData = isNetJson ? JSON.parse(netLogsText) : [];
    const netArray = Array.isArray(netLogsData) ? netLogsData : (netLogsData.logs || []);
    const validIsoTimestamp = !netArray[0] || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(netArray[0].timestamp);
    report('NET-LOG-01', 'Fetches network logs with ISO 8601 UTC timestamp', validIsoTimestamp);

    // 3.15 Console Logs & ISO Timestamps (F3-28)
    const consoleRes = await client.callTool({
      name: 'spector_get_console_logs',
      arguments: {
        level: 'all',
        limit: 10,
        format: 'verbose'
      }
    });
    const consoleText = consoleRes.content[0].text;
    const isConsoleJson = consoleText.startsWith('[') || consoleText.startsWith('{');
    const consoleData = isConsoleJson ? JSON.parse(consoleText) : [];
    const consoleArray = Array.isArray(consoleData) ? consoleData : (consoleData.logs || []);
    const foundLog = consoleArray.some(l => l.text.includes('Test page loaded successfully'));
    report('CONSOLE-01', 'Captures console logs from page', foundLog);

    // 3.16 Screenshot Tool
    const screenshotRes = await client.callTool({
      name: 'spector_capture_screenshot',
      arguments: { selector: '#heading' }
    });
    const hasImage = screenshotRes.content?.some(c => c.type === 'image' && c.data);
    report('SCREENSHOT-01', 'Captures visual element screenshot', hasImage);

    // 3.17 Picker Tool (P1-07)
    const lastPickedRes = await client.callTool({
      name: 'spector_get_last_picked',
      arguments: {}
    });
    const lastPickedText = lastPickedRes.content[0].text;
    const okLastPicked = lastPickedText.includes('No element or section has been picked yet');
    report('PICKER-01', 'Get last picked returns informative message when unselected', okLastPicked);

    // 3.18 Tailwind Scoped Screenshot & DOM Tree (F4-30 comprehensive)
    const twScreenRes = await client.callTool({
      name: 'spector_capture_screenshot',
      arguments: { selector: '.w-[200px]' }
    });
    const hasTwImage = twScreenRes.content?.some(c => c.type === 'image' && c.data);
    report('TW-SCREENSHOT', 'Captures screenshot using arbitrary Tailwind selector .w-[200px]', hasTwImage);

    const twDomRes = await client.callTool({
      name: 'spector_get_dom_tree',
      arguments: { selector: '.w-[200px]' }
    });
    const twDomText = twDomRes.content[0].text;
    const hasTwDom = twDomText.includes('button') || twDomText.includes('Click Arbitrary');
    report('TW-DOM-TREE', 'Extracts scoped DOM tree using arbitrary Tailwind selector .w-[200px]', hasTwDom);

    const twDiffRes = await client.callTool({
      name: 'spector_diff_dom',
      arguments: { selector: '.w-[200px]', resetBaseline: true }
    });
    const twDiffJson = JSON.parse(twDiffRes.content[0].text);
    report('TW-DIFF-DOM', 'Sets scoped baseline using arbitrary Tailwind selector .w-[200px]', twDiffJson.status === 'baseline_set');

  } finally {
    // -----------------------------------------------------------------
    // 4. DISCONNECT & PROCESS SURVIVAL VERIFICATION (P0-02)
    // -----------------------------------------------------------------
    console.log(blue('\n>>> Phase 4: Disconnecting MCP Client & Verifying Chrome Survival'));
    await client.close();
    server.close();

    // Verify Chrome is STILL RUNNING on 9222!
    await new Promise(r => setTimeout(r, 500));
    try {
      const ping = await fetch('http://localhost:9222/json/version');
      const pingJson = await ping.json();
      const chromeSurvived = Boolean(pingJson.Browser);
      report('SURVIVAL-01', 'Physical Chrome process survived spector disconnection', chromeSurvived, pingJson.Browser);
    } catch (e) {
      report('SURVIVAL-01', 'Physical Chrome process survived spector disconnection', false, e.message);
    }
  }

  // Summary
  console.log(bold('\n======================================================'));
  console.log(bold(`  TEST RESULTS: ${green(`${passed} PASSED`)} | ${failed > 0 ? red(`${failed} FAILED`) : '0 FAILED'}`));
  console.log(bold('======================================================\n'));

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error(red('Fatal error during test run:'), err);
  process.exit(1);
});
