#!/usr/bin/env node

import process from 'node:process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CdpSessionManager } from './browser/cdp-session.js';
import { SPECTOR_VERSION } from './constants.js';
import { logger } from './utils/logger.js';
import { registerSessionTools } from './tools/session.js';
import { registerPickerTools } from './tools/picker.js';
import { registerInspectTools } from './tools/inspect.js';
import { registerDiagnoseTool } from './tools/diagnose.js';
import { registerDesignTokensTool } from './tools/design-tokens.js';
import { registerInteractTool } from './tools/interact.js';
import { registerPreviewCssTool } from './tools/preview.js';
import { handleInitCommand, handleHelpCommand } from './cli/init.js';
import type { SpectorToolProfile } from './types.js';

export function createSpectorServer(
  manager = CdpSessionManager.getInstance(),
  profile: SpectorToolProfile = 'forensics'
): McpServer {
  const server = new McpServer({
    name: 'spector',
    version: SPECTOR_VERSION
  });

  const isForensics = profile === 'forensics';

  registerSessionTools(server, manager, { includeNavigate: !isForensics });
  registerPickerTools(server, manager);
  registerInspectTools(server, manager, { includeDomTree: !isForensics });
  registerDiagnoseTool(server, manager);
  registerDesignTokensTool(server, manager);
  if (!isForensics) {
    registerInteractTool(server, manager);
  }
  registerPreviewCssTool(server, manager);

  return server;
}

function parseProfileOption(options: string[], allowProfileFlag: boolean): { profile: SpectorToolProfile; helpRequested: boolean; invalidArg?: string } {
  const envProfile = process.env.SPECTOR_PROFILE;
  let profile: SpectorToolProfile = envProfile === 'full' ? 'full' : 'forensics';
  if (envProfile !== undefined && envProfile !== 'full' && envProfile !== 'forensics') {
    return { profile, helpRequested: false, invalidArg: `SPECTOR_PROFILE=${envProfile}` };
  }

  let helpRequested = false;
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (opt === '--help' || opt === '-h') {
      helpRequested = true;
      continue;
    }
    if (allowProfileFlag && opt === '--profile') {
      const value = options[i + 1];
      if (value !== 'full' && value !== 'forensics') {
        return { profile, helpRequested, invalidArg: value ?? '--profile' };
      }
      profile = value;
      i++;
      continue;
    }
    if (allowProfileFlag && opt.startsWith('--profile=')) {
      const value = opt.slice('--profile='.length);
      if (value !== 'full' && value !== 'forensics') {
        return { profile, helpRequested, invalidArg: opt };
      }
      profile = value;
      continue;
    }
    return { profile, helpRequested, invalidArg: opt };
  }

  return { profile, helpRequested };
}

async function main() {
  const args = process.argv.slice(2);

  const first = args[0];
  const knownCommands = ['serve', 'init'];
  const help = ['--help', '-h'];
  const version = ['--version', '-v'];

  const isBareServeFlag = first !== undefined && (first === '--profile' || first.startsWith('--profile='));
  const command = isBareServeFlag ? 'serve' : first;
  const options = isBareServeFlag ? args : args.slice(1);

  if (command !== undefined && ![...knownCommands, ...help, ...version].includes(command)) {
    console.error(`[spector] Unknown command or option: ${args.join(' ')}. Run spector --help for usage.`);
    process.exit(1);
  }

  const allowProfileFlag = command === undefined || command === 'serve';
  const parsed = parseProfileOption(options, allowProfileFlag);

  if ((help.includes(command) && options.length > 0) || (version.includes(command) && options.length > 0) || parsed.invalidArg) {
    console.error(`[spector] Unknown command or option: ${args.join(' ')}. Run spector --help for usage.`);
    process.exit(1);
  }

  if (help.includes(command) || parsed.helpRequested) {
    handleHelpCommand();
    return;
  }

  if (command === 'init') {
    handleInitCommand();
    process.exit(0);
  }

  if (version.includes(command)) {
    console.log(SPECTOR_VERSION);
    process.exit(0);
  }

  const server = createSpectorServer(CdpSessionManager.getInstance(), parsed.profile);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('spector_started', { version: SPECTOR_VERSION, transport: 'stdio', profile: parsed.profile });

  // Attach eagerly if dev Chrome is already listening without blocking server readiness.
  const eagerAttach = CdpSessionManager.getInstance()
    .attach('http://localhost:9222', true, false)
    .then(info => {
      logger.info('cdp_eagerly_attached', { title: info.title, url: info.url });
    })
    .catch(() => {
      logger.debug('cdp_eager_attach_idle', {
        message: 'Chrome dev profile is not running yet; will attach on-demand when tool is called'
      });
    });

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      logger.info('spector_shutting_down', { action: 'disconnecting_cdp' });
      try {
        await eagerAttach;
        await CdpSessionManager.getInstance().disconnect();
        await server.close();
      } catch {
        // Ignore teardown failures on closing sockets during shutdown.
      }
      process.exit(0);
    })();
    return shutdownPromise;
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdin.once('end', shutdown);
  server.server.onclose = shutdown;
}

const isDirectExecution = (() => {
  try {
    const entryPath = fileURLToPath(import.meta.url);
    if (entryPath.includes('$bunfs') || entryPath.includes('~BUN')) return true;
    return Boolean(process.argv[1] && realpathSync(process.argv[1]) === realpathSync(entryPath));
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main().catch(error => {
    console.error('[spector] Fatal error:', error);
    process.exit(1);
  });
}
