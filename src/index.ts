#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BrowserManager } from './browser-manager.js';
import { registerAttachTool } from './tools/attach.js';
import { registerDomTool } from './tools/dom.js';
import { registerScreenshotTool } from './tools/screenshot.js';
import { registerNetworkTool } from './tools/network.js';
import { registerConsoleTool } from './tools/console.js';
import { registerInteractTool } from './tools/interact.js';
import { registerNavigateTool } from './tools/navigate.js';
import { registerTabsTools } from './tools/tabs.js';
import { registerPickerTool } from './tools/picker.js';
import { registerDiffTool } from './tools/diff.js';
import { handleInitCommand, handleHelpCommand } from './cli/init.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('init')) {
    handleInitCommand();
    process.exit(0);
  }

  if (args.includes('--help') || args.includes('-h')) {
    handleHelpCommand();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('1.0.0');
    process.exit(0);
  }

  const server = new McpServer({
    name: 'spector',
    version: '1.0.0'
  });

  // Register all modular tools
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

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[spector] MCP Server running on stdio');

  // Eager non-blocking attach to dedicated dev window if already running on port 9222
  BrowserManager.getInstance()
    .attach('http://localhost:9222', true, false)
    .then(info => {
      console.error(`[spector] Eagerly attached to Chrome window (${info.title})`);
    })
    .catch(() => {
      // Chrome dev profile is not running yet; will attach on-demand when tool is called
    });

  // Handle clean disconnection
  const cleanup = async () => {
    console.error('[spector] Shutting down, disconnecting from Chrome CDP...');
    try {
      await BrowserManager.getInstance().disconnect();
    } catch {
      // Ignore
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(error => {
  console.error('[spector] Fatal error:', error);
  process.exit(1);
});
