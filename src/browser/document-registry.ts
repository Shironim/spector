import type { Frame, Page } from 'playwright-core';
import { SpectorError } from '../utils/mcp-response.js';
import { randomUUID } from 'node:crypto';

export class DocumentRegistry {
  private sequence = 0;
  private elementSequence = 0;
  private readonly owner = randomUUID();
  private entries = new Map<Page, { id: string; navigate: (frame: Frame) => void; close: () => void }>();

  public id(page: Page): string {
    if (page.isClosed()) throw new SpectorError('TARGET_CHANGED', 'Cannot identify a closed document.');
    const known = this.entries.get(page);
    if (known) return known.id;
    const entry = {
      id: `document-${++this.sequence}`,
      navigate: (frame: Frame) => { if (frame === page.mainFrame()) entry.id = `document-${++this.sequence}`; },
      close: () => this.release(page)
    };
    this.entries.set(page, entry);
    page.on('framenavigated', entry.navigate);
    page.on('close', entry.close);
    return entry.id;
  }

  public async elementId(page: Page, selector: string): Promise<string | null> {
    const candidate = `${this.owner}:element-${++this.elementSequence}`;
    this.id(page);
    return page.evaluate(({ selector, candidate }) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const scope = window as typeof window & { __spectorElements?: WeakMap<Element, string> };
      scope.__spectorElements ??= new WeakMap();
      let id = scope.__spectorElements.get(element);
      if (!id) { id = candidate; scope.__spectorElements.set(element, id); }
      return id;
    }, { selector, candidate });
  }

  private release(page: Page): void {
    const entry = this.entries.get(page);
    if (!entry) return;
    page.off('framenavigated', entry.navigate); page.off('close', entry.close);
    this.entries.delete(page);
  }

  public clear(): void { for (const page of this.entries.keys()) this.release(page); }
}
