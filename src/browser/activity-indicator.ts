import type { Page } from 'playwright-core';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { SpectorError } from '../utils/mcp-response.js';

interface ActivityState {
  count: number;
  hidden: number;
  onNavigation: () => void;
}

export class ActivityIndicator {
  private states = new Map<Page, ActivityState>();
  private revision = 0;
  private readonly owner = randomUUID();

  public constructor(private readonly expiryMs = 60000) {}

  private async render(page: Page, state: ActivityState): Promise<boolean> {
    const revision = ++this.revision;
    try {
      await page.evaluate(({ active, hidden, revision, expiryMs, owner }) => {
        const scope = window as typeof window & { __spectorActivity?: { owner: string; revision: number; timer: ReturnType<typeof setTimeout> } };
        if (scope.__spectorActivity?.owner === owner && scope.__spectorActivity.revision > revision) return;
        if (scope.__spectorActivity) clearTimeout(scope.__spectorActivity.timer);
        const previous = document.querySelector('[data-spector-activity]');
        previous?.remove();
        const timer = setTimeout(() => document.querySelector('[data-spector-activity]')?.remove(), expiryMs);
        scope.__spectorActivity = { owner, revision, timer };
        if (!active) { clearTimeout(timer); return; }
        const host = document.createElement('div');
        host.setAttribute('data-spector-activity', '');
        host.style.cssText = 'all:initial!important;position:fixed!important;right:8px!important;bottom:8px!important;z-index:2147483647!important;pointer-events:none!important;max-width:calc(100vw - 16px)!important;contain:layout style!important;';
        if (hidden) host.style.setProperty('visibility', 'hidden', 'important');
        const shadow = host.attachShadow({ mode: 'open' });
        const label = document.createElement('div');
        label.setAttribute('role', 'status');
        label.textContent = 'Spector sedang menggunakan tab ini';
        label.style.cssText = 'box-sizing:border-box;padding:8px 10px;background:#17232e;color:#ffffff;border:1px solid #ffffff;font:12px/1.4 system-ui,sans-serif;border-radius:4px;overflow-wrap:anywhere;pointer-events:none;';
        shadow.append(label);
        document.documentElement.append(host);
        const controls = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]'))
          .slice(0, 600).map(el => el.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
        let best = { corner: 0, overlaps: Infinity };
        const place = (corner: number) => {
          host.style.setProperty('right', corner % 2 === 0 ? '8px' : 'auto', 'important');
          host.style.setProperty('left', corner % 2 === 1 ? '8px' : 'auto', 'important');
          host.style.setProperty('bottom', corner < 2 ? '8px' : 'auto', 'important');
          host.style.setProperty('top', corner >= 2 ? '8px' : 'auto', 'important');
        };
        for (let corner = 0; corner < 4; corner++) {
          place(corner);
          const rect = host.getBoundingClientRect();
          const overlaps = controls.filter(control => rect.left < control.right && rect.right > control.left && rect.top < control.bottom && rect.bottom > control.top).length;
          if (overlaps < best.overlaps) best = { corner, overlaps };
          if (overlaps === 0) break;
        }
        place(best.corner);
      }, { active: state.count > 0, hidden: state.hidden > 0, revision, expiryMs: this.expiryMs, owner: this.owner });
      return true;
    } catch {
      logger.debug('activity_indicator_unavailable', { reason: 'Target is unavailable or navigating.' });
      return false;
    }
  }

  public async run<T>(page: Page, operation: () => Promise<T>): Promise<T> {
    let state = this.states.get(page);
    if (!state) {
      state = { count: 0, hidden: 0, onNavigation: () => {} };
      const current = state;
      state.onNavigation = () => { if (current.count > 0) void this.render(page, current); };
      this.states.set(page, state);
      page.on('domcontentloaded', state.onNavigation);
    }
    state.count++;
    await this.render(page, state);
    try { return await operation(); }
    finally {
      if (this.states.get(page) === state) {
        state.count = Math.max(0, state.count - 1);
        await this.render(page, state);
        if (state.count === 0) {
          page.off('domcontentloaded', state.onNavigation);
          if (this.states.get(page) === state) this.states.delete(page);
        }
      }
    }
  }

  public async withoutIndicator<T>(page: Page, operation: () => Promise<T>): Promise<T> {
    const state = this.states.get(page);
    if (!state) return operation();
    state.hidden++;
    try {
      if (!await this.render(page, state)) throw new SpectorError('TOOL_OPERATION_FAILED', 'Cannot exclude activity indicator from screenshot.');
      return await operation();
    }
    finally {
      state.hidden--;
      if (this.states.get(page) === state) await this.render(page, state);
    }
  }

  public async clear(): Promise<void> {
    await Promise.all([...this.states].map(async ([page, state]) => {
      state.count = 0;
      page.off('domcontentloaded', state.onNavigation);
      await this.render(page, state);
    }));
    this.states.clear();
  }
}
