#!/usr/bin/env node

import process from 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BrowserManager } from './browser-manager.js';
import { logger } from './utils/logger.js';
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
    console.log('1.0.2');
    process.exit(0);
  }

  const server = new McpServer({
    name: 'spector',
    version: '1.0.2'
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

  logger.info('spector_started', { version: '1.0.2', transport: 'stdio' });

  // Eager non-blocking attach to dedicated dev window if already running on port 9222
  BrowserManager.getInstance()
    .attach('http://localhost:9222', true, false)
    .then(info => {
      logger.info('cdp_eagerly_attached', { title: info.title, url: info.url });
    })
    .catch(() => {
      logger.debug('cdp_eager_attach_idle', { message: 'Chrome dev profile is not running yet; will attach on-demand when tool is called' });
    });

  // Handle clean disconnection
  const cleanup = async () => {
    logger.info('spector_shutting_down', { action: 'disconnecting_cdp' });
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
