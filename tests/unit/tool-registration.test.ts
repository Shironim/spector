import { describe, it } from 'bun:test';
import assert from 'node:assert';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAttachTool } from '../../src/tools/attach.js';
import { registerTabsTools } from '../../src/tools/tabs.js';
import { registerPickerTool } from '../../src/tools/picker.js';
import { registerDomTool } from '../../src/tools/dom.js';
import { registerDiffTool } from '../../src/tools/diff.js';
import { registerScreenshotTool } from '../../src/tools/screenshot.js';
import { registerNetworkTool } from '../../src/tools/network.js';
import { registerConsoleTool } from '../../src/tools/console.js';
import { registerInteractTool } from '../../src/tools/interact.js';
import { registerNavigateTool } from '../../src/tools/navigate.js';

describe('MCP Tool Registration & Contract Integrity', () => {
  it('registers all 11 core tools successfully without schema collisions', () => {
    const server = new McpServer({
      name: 'spector-test',
      version: '1.0.4'
    });

    // Register all tools
    registerAttachTool(server);
    registerTabsTools(server);
    registerPickerTool(server);
    registerDomTool(server);
    registerDiffTool(server);
    registerScreenshotTool(server);
    registerNetworkTool(server);
    registerConsoleTool(server);
    registerInteractTool(server);
    registerNavigateTool(server);

    // Verify registered tools on server._registeredTools or similar internal map
    const tools = (server as any)._registeredTools;
    assert.ok(tools, 'server should have registered tools');

    const expectedToolNames = [
      'spector_attach',
      'spector_list_tabs',
      'spector_select_tab',
      'spector_get_last_picked',
      'spector_pick_element',
      'spector_get_dom_tree',
      'spector_diff_dom',
      'spector_capture_screenshot',
      'spector_get_network_logs',
      'spector_mock_network',
      'spector_get_console_logs',
      'spector_interact',
      'spector_navigate'
    ];

    for (const name of expectedToolNames) {
      assert.ok(tools[name], `Expected tool "${name}" to be registered on McpServer`);
    }
  });
});
