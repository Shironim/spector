import { describe, it, expect } from 'bun:test';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { coreToolNames } from '../tool-contract.js';

const entry = resolve(import.meta.dir, '../../src/index.ts');
const run = (args: string[], cwd?: string) => spawnSync(process.execPath, [entry, ...args], {
  encoding: 'utf8', timeout: 5000, cwd
});

describe('Spector CLI', () => {
  it('documents serve without starting MCP', () => {
    for (const args of [['--help'], ['serve', '--help'], ['init', '-h']]) {
      const result = run(args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('serve');
      expect(result.stderr).not.toContain('spector_started');
    }
    expect(run(['--version']).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('rejects unknown commands and extra arguments before performing init or startup', () => {
    for (const args of [['sevre'], ['serve', '--port', '3000'], ['serve', '--profile', 'full'], ['serve', 'init'], ['init', 'serve'], ['--help', 'oops']]) {
      const result = run(args);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Unknown command or option');
      expect(result.stderr).not.toContain('spector_started');
    }
  });

  it('exposes the 5 core tools over stdio MCP for serve and bare alias', async () => {
    for (const args of [[entry, 'serve'], [entry]]) {
      const transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe' });
      const client = new Client({ name: 'cli-core-tools', version: '1.0.0' });
      try {
        await client.connect(transport, { timeout: 5000 });
        const names = (await client.listTools()).tools.map(tool => tool.name).sort();
        expect(names).toEqual(coreToolNames);
      } finally { await client.close(); }
    }
  }, 15000);

  it('prints the standard MCP configuration from init', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spector-init-'));
    try {
      const result = run(['init'], dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"@dimassetoid/spector", "serve"');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('supports MCP initialization and discovery through a bin symlink and legacy alias', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spector-bin-'));
    const bin = join(dir, 'spector');
    symlinkSync(entry, bin);
    try {
      for (const args of [[bin, 'serve'], [entry]]) {
        const transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe' });
        const client = new Client({ name: 'cli-regression', version: '1.0.0' });
        try {
          await client.connect(transport, { timeout: 5000 });
          expect(client.getServerVersion()?.name).toBe('spector');
          expect((await client.listTools()).tools.map(tool => tool.name)).toContain('spector_attach');
        } finally { await client.close(); }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 15000);

  it('exits cleanly when the client closes stdin', () => {
    const result = run(['serve']);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('spector_shutting_down');
  });
});
