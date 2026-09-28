import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { textResponse } from '../types.js';

export function registerDomTool(server: McpServer): void {
  const domSchema = {
    selector: z
      .string()
      .optional()
      .describe('Selector CSS root jika ingin membatasi inspeksi pada komponen/container tertentu (e.g. "#main-card", ".modal")'),
    includeBoundingBox: z
      .boolean()
      .optional()
      .describe('Sertakan data koordinat piksel [box=x,y,w,h] (default: true)'),
    includeOffscreen: z
      .boolean()
      .optional()
      .describe('Sertakan elemen di luar viewport (slider, carousel, horizontal scroll, accordion) atau elemen dengan animasi AOS/fade-in (default: false)')
  };

  const domHandler = async ({ selector, includeBoundingBox, includeOffscreen }: any) => {
    const manager = BrowserManager.getInstance();
    const domTree = await manager.getDomTree(selector, includeBoundingBox ?? true, includeOffscreen ?? false);

    return textResponse(domTree);
  };

  server.tool(
    'spector_get_dom_tree',
    '[READ-ONLY MAP & TOKEN-LEAN DOM] Mengambil struktur semantik DOM yang dioptimalkan untuk LLM (token-lean). Gunakan saat ingin memahami tata letak awal atau hierarki UI makro. CATATAN: Untuk memverifikasi dampak aksi klik/input/mutasi kode, utamakan spector_diff_dom atau spector_pick_element alih-alih me-dump seluruh DOM ulang untuk mencegah context rot.',
    domSchema,
    domHandler
  );

  server.tool('browser_get_dom_tree', '[Alias for spector_get_dom_tree]', domSchema, domHandler);
}
