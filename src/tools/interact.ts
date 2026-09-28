import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';
import { textResponse } from '../types.js';

export function registerInteractTool(server: McpServer): void {
  const interactSchema = {
    action: z
      .enum(['click', 'type', 'fill', 'hover', 'scroll', 'scrollIntoView', 'press_key'])
      .describe('Aksi yang ingin dilakukan: "click", "hover", "type", "fill", "scroll", "scrollIntoView" (langsung scroll elemen ke tengah viewport), "press_key"'),
    selector: z
      .string()
      .optional()
      .describe('Selector CSS elemen target (wajib untuk click, type, fill, hover, scrollIntoView)'),
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
        x: z.number().optional().describe('Delta scroll horizontal dalam piksel'),
        y: z.number().optional().describe('Delta scroll vertikal dalam piksel')
      })
      .optional()
      .describe('Besaran delta scroll jika action adalah "scroll"'),
    scrollX: z
      .number()
      .optional()
      .describe('Pintasan delta scroll horizontal (alternatif scrollDelta.x)'),
    scrollY: z
      .number()
      .optional()
      .describe('Pintasan delta scroll vertikal (alternatif scrollDelta.y, default: 300 jika tidak diset)'),
    waitForNavigation: z
      .boolean()
      .optional()
      .describe('Tunggu hingga navigasi halaman atau perubahan URL selesai setelah interaksi click (default: false)'),
    waitForTimeoutMs: z
      .number()
      .optional()
      .describe('Batas waktu jeda tambahan (ms) setelah interaksi untuk memberi waktu animasi atau render UI selesai (default: 0)')
  };

  const interactHandler = async ({ action, selector, text, clearFirst, key, scrollDelta, scrollX, scrollY, waitForNavigation, waitForTimeoutMs }: any) => {
    const manager = BrowserManager.getInstance();
    const effectiveDelta = (scrollDelta || scrollX !== undefined || scrollY !== undefined)
      ? {
          x: scrollDelta?.x ?? scrollX ?? 0,
          y: scrollDelta?.y ?? scrollY ?? 300
        }
      : undefined;

    const message = await manager.interact(
      action,
      selector,
      text,
      key,
      effectiveDelta,
      clearFirst ?? false,
      waitForNavigation ?? false,
      waitForTimeoutMs ?? 0
    );

    return textResponse(message);
  };

  server.tool(
    'spector_interact',
    '[AUTOMATION: USER DISPATCH] Melakukan simulasi interaksi pengguna pada elemen halaman web (click, type, fill, hover, scroll, press_key) dengan auto-waiting untuk menguji alur form dan perubahan state UI.',
    interactSchema,
    interactHandler
  );

  server.tool('browser_interact', '[Alias for spector_interact]', interactSchema, interactHandler);
}
