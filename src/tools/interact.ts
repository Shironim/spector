import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';

export function registerInteractTool(server: McpServer): void {
  const interactSchema = {
    action: z
      .enum(['click', 'type', 'fill', 'hover', 'scroll', 'press_key'])
      .describe('Aksi yang ingin dilakukan: "fill" (mengosongkan & mengisi instan), "type" (ketik karakter per karakter), "click", "hover", "scroll", "press_key"'),
    selector: z
      .string()
      .optional()
      .describe('Selector CSS elemen target (wajib untuk click, type, fill, hover)'),
    text: z
      .string()
      .optional()
      .describe('Teks yang akan diinput jika action adalah "type" atau "fill"'),
    clearFirst: z
      .boolean()
      .optional()
      .describe('Kosongkan teks lama sebelum mengetik jika action adalah "type" (default: false)'),
    key: z
      .string()
      .optional()
      .describe('Kode keyboard jika action adalah "press_key" (e.g. "Enter", "Escape", "Tab")'),
    scrollDelta: z
      .object({
        x: z.number().describe('Delta scroll horizontal dalam piksel'),
        y: z.number().describe('Delta scroll vertikal dalam piksel')
      })
      .optional()
      .describe('Besaran delta scroll jika action adalah "scroll"')
  };

  const interactHandler = async ({ action, selector, text, clearFirst, key, scrollDelta }: any) => {
    const manager = BrowserManager.getInstance();
    const message = await manager.interact(action, selector, text, key, scrollDelta, clearFirst ?? false);

    return {
      content: [
        {
          type: 'text',
          text: message
        }
      ]
    };
  };

  server.tool(
    'spector_interact',
    '[AUTOMATION: USER DISPATCH] Melakukan simulasi interaksi pengguna pada elemen halaman web (click, type, fill, hover, scroll, press_key) dengan auto-waiting untuk menguji alur form dan perubahan state UI.',
    interactSchema,
    interactHandler
  );

  server.tool('browser_interact', '[Alias for spector_interact]', interactSchema, interactHandler);
}
