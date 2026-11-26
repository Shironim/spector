import { describe, it } from 'bun:test';
import assert from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSpectorServer } from '../../src/index.js';
import { CdpSessionManager } from '../../src/browser/cdp-session.js';
import { coreToolNames } from '../tool-contract.js';

describe('MCP Tool Registration & Wire-Level Protocol Contract (Spector Slim)', () => {
  it('registers exactly the 6 core tools with MCP annotations over real InMemoryTransport', async () => {
    const manager = new CdpSessionManager();
    const server = createSpectorServer(manager);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'spector-protocol-test', version: '1.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name).sort();
      assert.deepStrictEqual(names, coreToolNames);

      // Verify pruned/legacy tools are absent
      for (const removed of [
        'spector_navigate',
        'spector_get_dom_tree',
        'spector_preview_css',
        'spector_extract_tokens',
        'spector_list_tabs',
        'spector_select_tab'
      ]) {
        assert.ok(!names.includes(removed), `Pruned tool "${removed}" should not be registered`);
      }

      // Verify annotations exist on every tool
      for (const tool of tools) {
        assert.ok(tool.annotations, `Tool "${tool.name}" should declare MCP annotations`);
      }
      const diagnoseTool = tools.find(t => t.name === 'spector_diagnose');
      assert.strictEqual(diagnoseTool?.annotations?.readOnlyHint, true);

      // Verify wire-level tool invocation when unattached returns structured fail-safe error
      const pickerRes = await client.callTool({ name: 'spector_picker', arguments: { action: 'get' } });
      assert.strictEqual(pickerRes.isError, true);
      const body = JSON.parse((pickerRes.content as Array<{ text: string }>)[0].text);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.data.code, 'BROWSER_NOT_ATTACHED');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
