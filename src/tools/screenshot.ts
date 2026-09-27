import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserManager } from '../browser-manager.js';

export function registerScreenshotTool(server: McpServer): void {
  const screenshotSchema = {
    selector: z
      .string()
      .optional()
      .describe('Selector elemen spesifik jika hanya ingin menangkap screenshot elemen tertentu (e.g. "#header", ".pricing-table")'),
    fullPage: z
      .boolean()
      .optional()
      .describe('Ambil screenshot seluruh tinggi halaman yang bisa di-scroll (default: false)')
  };

  const screenshotHandler = async ({ selector, fullPage }: any) => {
    const manager = BrowserManager.getInstance();
    const buffer = await manager.captureScreenshot(selector, fullPage ?? false);
    const base64Data = buffer.toString('base64');

    return {
      content: [
        {
          type: 'image',
          data: base64Data,
          mimeType: 'image/png'
        },
        {
          type: 'text',
          text: `Screenshot captured successfully${selector ? ` for selector "${selector}"` : ''} (${Math.round(buffer.length / 1024)} KB).`
        }
      ]
    };
  };

  server.tool(
    'spector_capture_screenshot',
    '[VISUAL AUDIT: PIXEL SNAPSHOT] Menghasilkan tangkapan layar (screenshot) halaman aktif atau elemen spesifik untuk verifikasi visual pixel-perfect dan layout rendering.',
    screenshotSchema,
    screenshotHandler
  );

  server.tool('browser_capture_screenshot', '[Alias for spector_capture_screenshot]', screenshotSchema, screenshotHandler);
}
