import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';

export function registerDomTool(server: McpServer): void {
  const domSchema = {
    selector: z
      .string()
      .optional()
      .describe('Selector CSS root jika ingin membatasi inspeksi pada komponen/container tertentu (e.g. "#main-card", ".modal")'),
    includeBoundingBox: z
      .boolean()
      .optional()
      .describe('Sertakan data koordinat piksel [box=x,y,w,h] (default: true)')
  };

  const domHandler = async ({ selector, includeBoundingBox }: any) => {
    const manager = BrowserManager.getInstance();
    const domTree = await manager.getDomTree(selector, includeBoundingBox ?? true);

    return {
      content: [
        {
          type: 'text',
          text: domTree
        }
      ]
    };
  };

  server.tool(
    'spector_get_dom_tree',
    '[READ-ONLY MAP & TOKEN-LEAN DOM] Mengambil struktur semantik DOM yang dioptimalkan untuk LLM (token-lean) dalam bentuk pohon semantik ringkas, dilengkapi koordinat bounding box [box=x,y,w,h]. Menghemat token hingga 95% dibanding raw HTML. Gunakan saat ingin memahami tata letak dan hierarki UI.',
    domSchema,
    domHandler
  );

  server.tool('browser_get_dom_tree', '[Alias for spector_get_dom_tree]', domSchema, domHandler);
}
