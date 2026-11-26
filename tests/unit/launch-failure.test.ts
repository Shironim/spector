import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test.skipIf(process.platform !== 'linux')('missing Chrome returns an MCP error and the server handles the next request', () => {
  const emptyPath = mkdtempSync(join(tmpdir(), 'spector-no-chrome-'));
  try {
    const result = spawnSync(process.execPath, ['-e', `
      import { Client } from '@modelcontextprotocol/sdk/client/index.js';
      import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
      import { createSpectorServer } from './src/index.ts';
      import { CdpSessionManager } from './src/browser/cdp-session.ts';
      const manager = new CdpSessionManager();
      const server = createSpectorServer(manager);
      const client = new Client({name:'launch-failure',version:'1'});
      const [s,c] = InMemoryTransport.createLinkedPair();
      await server.connect(s); await client.connect(c);
      try {
        const failed = await client.callTool({name:'spector_attach',arguments:{cdpUrl:'http://127.0.0.1:1',autoLaunch:true}});
        const next = await client.callTool({name:'spector_picker',arguments:{action:'clear'}});
        console.log(JSON.stringify({failed,next}));
      } finally { await client.close(); await server.close(); await manager.disconnect(); }
    `], { cwd: resolve(import.meta.dir, '../..'), env: {...process.env, PATH:emptyPath}, encoding:'utf8', timeout:15000 });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Unhandled');
    const {failed,next} = JSON.parse(result.stdout);
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed.content)).toContain('CHROME_CDP_UNAVAILABLE');
    expect(next.isError).not.toBe(true);
    expect(JSON.parse(next.content[0].text).success).toBe(true);
  } finally { rmSync(emptyPath, {recursive:true,force:true}); }
}, 20000);
