import { describe, it } from 'bun:test';
import assert from 'node:assert';
import { createSpectorServer } from '../../src/index.js';

describe('MCP Tool Registration & Contract Integrity (Spector v2)', () => {
  it('defaults to the 7 core forensics tools and excludes automation/removed v1 tools', () => {
    const server = createSpectorServer();
    const tools = (server as any)._registeredTools;
    assert.ok(tools, 'server should have registered tools');

    const forensicsTools = [
      'spector_attach',
      'spector_tabs',
      'spector_picker',
      'spector_capture_screenshot',
      'spector_diagnose',
      'spector_extract_tokens',
      'spector_preview_css'
    ];

    for (const name of forensicsTools) {
      assert.ok(tools[name], `Expected forensics tool "${name}" to be registered by default`);
    }

    for (const omitted of ['spector_navigate', 'spector_get_dom_tree', 'spector_interact']) {
      assert.strictEqual(tools[omitted], undefined, `Tool "${omitted}" should be omitted in default forensics profile`);
    }

    const removedToolNames = [
      'spector_list_tabs',
      'spector_select_tab',
      'spector_get_last_picked',
      'spector_pick_element',
      'spector_diff_dom',
      'spector_mock_network',
      'spector_get_network_logs',
      'spector_get_console_logs'
    ];

    for (const name of removedToolNames) {
      assert.strictEqual(tools[name], undefined, `Removed v1 tool "${name}" should not be registered`);
    }
  });

  it('registers all 10 tools when profile is "full"', () => {
    const server = createSpectorServer(undefined, 'full');
    const tools = (server as any)._registeredTools;
    assert.ok(tools, 'server should have registered tools');

    const expectedToolNames = [
      'spector_attach',
      'spector_tabs',
      'spector_navigate',
      'spector_picker',
      'spector_get_dom_tree',
      'spector_capture_screenshot',
      'spector_diagnose',
      'spector_extract_tokens',
      'spector_interact',
      'spector_preview_css'
    ];

    for (const name of expectedToolNames) {
      assert.ok(tools[name], `Expected full-profile tool "${name}" to be registered on McpServer`);
    }
  });
});
