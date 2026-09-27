import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';

export function registerPickerTool(server: McpServer): void {
  const pickElementHandler = async ({ timeoutMs, includeScreenshot, includeStyles }: any) => {
    const manager = BrowserManager.getInstance();
    const result = await manager.pickElement(
      timeoutMs ?? 30000,
      includeScreenshot ?? true,
      includeStyles ?? true
    );

    if (result.status === 'cancelled') {
      return {
        content: [
          {
            type: 'text',
            text: 'Pemilihan elemen dibatalkan oleh pengguna (Esc ditekan).'
          }
        ]
      };
    }

    if (result.status === 'timeout') {
      return {
        content: [
          {
            type: 'text',
            text: 'Waktu pemilihan elemen habis (timeout). Tidak ada elemen yang diklik.'
          }
        ]
      };
    }

    const contentBlocks: any[] = [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: 'selected',
            selector: result.selector,
            tagName: result.tagName,
            frameworkComponent: result.frameworkComponent,
            rect: result.rect,
            computedStyles: result.computedStyles,
            domTree: result.domTree
          },
          null,
          2
        )
      }
    ];

    if (result.screenshotBase64) {
      contentBlocks.push({
        type: 'image',
        data: result.screenshotBase64,
        mimeType: 'image/png'
      });
    }

    return {
      content: contentBlocks
    };
  };

  const pickElementSchema = {
    timeoutMs: z
      .number()
      .optional()
      .describe('Batas waktu tunggu developer mengklik elemen dalam milidetik (default: 30000 / 30 detik)'),
    includeScreenshot: z
      .boolean()
      .optional()
      .describe('Ambil screenshot spesifik elemen/section yang dipilih secara otomatis (default: true)'),
    includeStyles: z
      .boolean()
      .optional()
      .describe('Ekstrak computed CSS design tokens seperti layout flex/grid, colors, typography, border-radius, spacing (default: true)')
  };

  const getLastPickedHandler = async ({ clearAfterRead }: any) => {
    const manager = BrowserManager.getInstance();
    const result = manager.getLastPickedElement(clearAfterRead ?? false);

    if (!result) {
      return {
        content: [
          {
            type: 'text',
            text: 'Belum ada elemen/section yang dipilih. Anda dapat menekan tombol Alt + P pada tab browser Chrome kapan saja untuk memilih section target dan menyimpannya ke Spector AI.'
          }
        ]
      };
    }

    const contentBlocks: any[] = [
      {
        type: 'text',
        text: JSON.stringify(
          {
            status: 'selected',
            timestamp: result.timestamp,
            selector: result.selector,
            tagName: result.tagName,
            frameworkComponent: result.frameworkComponent,
            rect: result.rect,
            computedStyles: result.computedStyles,
            domTree: result.domTree
          },
          null,
          2
        )
      }
    ];

    if (result.screenshotBase64) {
      contentBlocks.push({
        type: 'image',
        data: result.screenshotBase64,
        mimeType: 'image/png'
      });
    }

    return {
      content: contentBlocks
    };
  };

  const getLastPickedSchema = {
    clearAfterRead: z
      .boolean()
      .optional()
      .describe('Hapus cache elemen terakhir setelah dibaca (default: false)')
  };

  // Primary Spector tools
  server.tool(
    'spector_get_last_picked',
    '[PRIMARY FOR UI FIX & POINT-AND-PROMPT] Mengambil data elemen/section terakhir yang dipilih developer via Alt+P di browser. WAJIB dipanggil pertama kali saat developer meminta perbaikan tampilan (padding, warna, font, layout) atau menyebut "elemen yang barusan saya klik". Mengembalikan CSS selector presisi, computed design tokens, Accessibility DOM tree, dan cropped screenshot.',
    getLastPickedSchema,
    getLastPickedHandler
  );

  server.tool(
    'spector_pick_element',
    '[PROACTIVE PICK] Mengaktifkan mode visual inspector interaktif di layar browser dan menunggu developer mengeklik komponen target. Menghasilkan selector unik, design tokens, DOM tree, dan screenshot.',
    pickElementSchema,
    pickElementHandler
  );

  // Backward-compatibility aliases
  server.tool('browser_get_last_picked', '[Alias for spector_get_last_picked]', getLastPickedSchema, getLastPickedHandler);
  server.tool('browser_pick_element', '[Alias for spector_pick_element]', pickElementSchema, pickElementHandler);
}
