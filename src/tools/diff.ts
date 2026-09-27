import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';

export function registerDiffTool(server: McpServer): void {
  const diffSchema = {
    selector: z
      .string()
      .optional()
      .describe('Selector CSS root jika ingin membatasi komparasi pada kontainer tertentu (e.g. "#app", "main")'),
    resetBaseline: z
      .boolean()
      .optional()
      .describe('Set true jika ingin merekam ulang baseline awal dari state DOM saat ini')
  };

  const diffHandler = async ({ selector, resetBaseline }: any) => {
    const manager = BrowserManager.getInstance();
    const result = await manager.diffDom(selector, resetBaseline ?? false);

    let message = '';
    if (result.status === 'baseline_set') {
      message = `Baseline DOM snapshot berhasil direkam pada ${result.currentTimestamp}. Lakukan perubahan kode atau aksi UI, lalu panggil kembali spector_diff_dom untuk melihat perubahannya.`;
    } else {
      const { addedCount, removedCount, mutatedCount, textChangesCount } = result.summary;
      message = `Komparasi DOM: +${addedCount} elemen baru, -${removedCount} elemen dihapus, ~${mutatedCount} elemen termutasi (${textChangesCount} perubahan teks).`;
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              summaryMessage: message,
              ...result
            },
            null,
            2
          )
        }
      ]
    };
  };

  server.tool(
    'spector_diff_dom',
    '[SEMANTIC UI VERIFICATION & TOKEN SAVER] Membandingkan snapshot DOM saat ini dengan baseline sebelum perubahan (atau merekam baseline baru). Mengembalikan delta mutasi (elemen baru, terhapus, perubahan teks, dan pergeseran bounding box) untuk memverifikasi perbaikan UI secara instan dan sangat hemat token.',
    diffSchema,
    diffHandler
  );

  server.tool('browser_diff_dom', '[Alias for spector_diff_dom]', diffSchema, diffHandler);
}
