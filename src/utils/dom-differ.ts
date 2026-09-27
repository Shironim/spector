import type { Page } from 'playwright-core';
import { IN_BROWSER_COMPONENT_DETECTOR_FN } from './framework-detector.js';

export interface ElementSnapshot {
  selector: string;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  ariaLabel?: string;
  componentName?: string;
  classes: string;
  box: { x: number; y: number; w: number; h: number };
}

export interface DomSnapshotData {
  timestamp: string;
  url: string;
  elements: ElementSnapshot[];
}

export interface DomDiffResult {
  status: 'compared' | 'baseline_set';
  baselineTimestamp?: string;
  currentTimestamp: string;
  summary: {
    addedCount: number;
    removedCount: number;
    mutatedCount: number;
    textChangesCount: number;
  };
  changes: {
    added: Array<{ selector: string; tag: string; role?: string; name?: string; text?: string; componentName?: string }>;
    removed: Array<{ selector: string; tag: string; role?: string; name?: string; text?: string; componentName?: string }>;
    mutated: Array<{
      selector: string;
      tag: string;
      componentName?: string;
      boxDiff?: { before: { x: number; y: number; w: number; h: number }; after: { x: number; y: number; w: number; h: number } };
      textDiff?: { before: string; after: string };
      classDiff?: { before: string; after: string };
    }>;
  };
}

export async function captureDomSnapshot(page: Page, rootSelector?: string): Promise<DomSnapshotData> {
  const elements = await page.evaluate(
    ({ selector, detectorScript }) => {
      // Evaluate detector
      const detectFn = new Function(`${detectorScript}; return detectFrameworkComponent;`)();

      const root = selector ? document.querySelector(selector) : document.body;
      if (!root) return [];

      const IGNORED_TAGS = new Set([
        'SCRIPT',
        'STYLE',
        'NOSCRIPT',
        'TEMPLATE',
        'HEAD',
        'META',
        'LINK',
        'SOURCE'
      ]);

      function isVisible(el: Element): boolean {
        if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function getCssSelector(el: Element): string {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const path: string[] = [];
        let curr: Element | null = el;
        while (curr && curr.nodeType === Node.ELEMENT_NODE && curr !== document.body && curr !== document.documentElement) {
          const tag = curr.tagName.toLowerCase();
          if (curr.id) {
            path.unshift(`#${CSS.escape(curr.id)}`);
            break;
          }
          const parent: Element | null = curr.parentElement;
          if (!parent) break;
          const siblings = Array.from(parent.children).filter(c => c.tagName.toLowerCase() === tag);
          if (siblings.length > 1) {
            const index = siblings.indexOf(curr) + 1;
            path.unshift(`${tag}:nth-of-type(${index})`);
          } else {
            path.unshift(tag);
          }
          curr = parent;
        }
        return path.length > 0 ? path.join(' > ') : el.tagName.toLowerCase();
      }

      function getDirectText(el: Element): string {
        let text = '';
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent?.trim() + ' ';
          }
        }
        return text.trim();
      }

      const results: any[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let currentNode = walker.currentNode as Element | null;

      while (currentNode) {
        if (!IGNORED_TAGS.has(currentNode.tagName) && isVisible(currentNode)) {
          const rect = currentNode.getBoundingClientRect();
          const role = currentNode.getAttribute('role') || undefined;
          const ariaLabel = currentNode.getAttribute('aria-label') || undefined;
          const text = getDirectText(currentNode) || undefined;
          const compInfo = detectFn(currentNode);

          results.push({
            selector: getCssSelector(currentNode),
            tag: currentNode.tagName.toLowerCase(),
            role,
            name: ariaLabel || text,
            text,
            ariaLabel,
            componentName: compInfo?.componentName,
            classes: currentNode.className && typeof currentNode.className === 'string' ? currentNode.className.trim() : '',
            box: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              w: Math.round(rect.width),
              h: Math.round(rect.height)
            }
          });
        }
        currentNode = walker.nextNode() as Element | null;
      }

      return results;
    },
    { selector: rootSelector, detectorScript: IN_BROWSER_COMPONENT_DETECTOR_FN }
  );

  return {
    timestamp: new Date().toISOString(),
    url: page.url(),
    elements
  };
}

export function compareDomSnapshots(baseline: DomSnapshotData, current: DomSnapshotData): DomDiffResult {
  const baselineMap = new Map<string, ElementSnapshot>();
  for (const el of baseline.elements) {
    baselineMap.set(el.selector, el);
  }

  const currentMap = new Map<string, ElementSnapshot>();
  for (const el of current.elements) {
    currentMap.set(el.selector, el);
  }

  const added: DomDiffResult['changes']['added'] = [];
  const removed: DomDiffResult['changes']['removed'] = [];
  const mutated: DomDiffResult['changes']['mutated'] = [];
  let textChangesCount = 0;

  // Find added and mutated
  for (const [selector, currEl] of currentMap) {
    const baseEl = baselineMap.get(selector);
    if (!baseEl) {
      added.push({
        selector,
        tag: currEl.tag,
        role: currEl.role,
        name: currEl.name,
        text: currEl.text,
        componentName: currEl.componentName
      });
    } else {
      let isMutated = false;
      const mutation: DomDiffResult['changes']['mutated'][0] = {
        selector,
        tag: currEl.tag,
        componentName: currEl.componentName
      };

      // Check text change
      if ((baseEl.text || '') !== (currEl.text || '')) {
        mutation.textDiff = { before: baseEl.text || '', after: currEl.text || '' };
        textChangesCount++;
        isMutated = true;
      }

      // Check class change
      if (baseEl.classes !== currEl.classes) {
        mutation.classDiff = { before: baseEl.classes, after: currEl.classes };
        isMutated = true;
      }

      // Check box shift (significant movement > 4px)
      const dx = Math.abs(baseEl.box.x - currEl.box.x);
      const dy = Math.abs(baseEl.box.y - currEl.box.y);
      const dw = Math.abs(baseEl.box.w - currEl.box.w);
      const dh = Math.abs(baseEl.box.h - currEl.box.h);

      if (dx > 4 || dy > 4 || dw > 4 || dh > 4) {
        mutation.boxDiff = { before: baseEl.box, after: currEl.box };
        isMutated = true;
      }

      if (isMutated) {
        mutated.push(mutation);
      }
    }
  }

  // Find removed
  for (const [selector, baseEl] of baselineMap) {
    if (!currentMap.has(selector)) {
      removed.push({
        selector,
        tag: baseEl.tag,
        role: baseEl.role,
        name: baseEl.name,
        text: baseEl.text,
        componentName: baseEl.componentName
      });
    }
  }

  return {
    status: 'compared',
    baselineTimestamp: baseline.timestamp,
    currentTimestamp: current.timestamp,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      mutatedCount: mutated.length,
      textChangesCount
    },
    changes: {
      added,
      removed,
      mutated
    }
  };
}
