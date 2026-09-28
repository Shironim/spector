import type { Page } from 'playwright-core';
import { IN_BROWSER_COMPONENT_DETECTOR_FN } from './framework-detector.js';

export interface DomTreeOptions {
  selector?: string;
  includeBoundingBox?: boolean;
  maxDepth?: number;
  includeOffscreen?: boolean;
}

export async function extractCompressedDom(page: Page, options: DomTreeOptions = {}): Promise<string> {
  const { selector, includeBoundingBox = true, maxDepth = 8, includeOffscreen = false } = options;

  return await page.evaluate(
    ({ rootSelector, withBoxes, depthLimit, withOffscreen, detectorScript }) => {
      const detectFn = new Function(`${detectorScript}; return detectFrameworkComponent;`)();
      const root = rootSelector ? document.querySelector(rootSelector) : document.body;
      if (!root) {
        return `Error: Root element not found for selector "${rootSelector || 'body'}".`;
      }

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
        if (style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }

        const hasAnim =
          el.hasAttribute('data-aos') ||
          el.hasAttribute('data-animate') ||
          el.hasAttribute('data-sal') ||
          el.hasAttribute('data-wow') ||
          (typeof el.className === 'string' && /\b(fade|aos|animate|transition|slide)\b/i.test(el.className));

        if (style.opacity === '0' && !hasAnim && !withOffscreen) {
          return false;
        }

        const rect = el.getBoundingClientRect();
        if (withOffscreen) {
          return rect.width > 0 || rect.height > 0 || el.children.length > 0;
        }

        // Element is visible if it has layout area, or has children waiting for animation
        return (rect.width > 0 && rect.height > 0) || (hasAnim && el.children.length > 0);
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

      function formatNode(el: Element, currentDepth: number): string[] {
        if (currentDepth > depthLimit) return [];
        if (IGNORED_TAGS.has(el.tagName)) return [];
        if (!isVisible(el)) return [];

        const lines: string[] = [];
        const indent = '  '.repeat(currentDepth);
        const tag = el.tagName.toLowerCase();

        // Special handling for SVG
        if (tag === 'svg') {
          const rect = el.getBoundingClientRect();
          const boxStr = withBoxes
            ? ` [box=${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}]`
            : '';
          const ariaLabel = el.getAttribute('aria-label') || el.querySelector('title')?.textContent || '';
          const labelStr = ariaLabel ? ` "${ariaLabel.trim()}"` : '';
          lines.push(`${indent}- <svg>${labelStr}${boxStr}`);
          return lines;
        }

        const role = el.getAttribute('role') || '';
        const id = el.id ? `#${el.id}` : '';
        const className = el instanceof HTMLElement && el.className && typeof el.className === 'string'
          ? el.className
              .split(/\s+/)
              .filter(c => c && !c.startsWith('hover:') && !c.startsWith('focus:'))
              .slice(0, 3)
              .map(c => `.${c}`)
              .join('')
          : '';

        const comp = typeof detectFn === 'function' ? detectFn(el) : null;
        const compHint = comp && comp.componentName ? ` [${comp.framework}:${comp.componentName}]` : '';

        const rect = el.getBoundingClientRect();
        const boxStr = withBoxes
          ? ` [box=${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}]`
          : '';

        const roleStr = role ? ` role="${role}"` : '';
        const directText = getDirectText(el);
        const ariaLabel = el.getAttribute('aria-label') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const typeAttr = el.getAttribute('type') || '';
        const hrefAttr = el.getAttribute('href') || '';

        let extraDetails = '';
        if (typeAttr) extraDetails += ` type="${typeAttr}"`;
        if (hrefAttr) extraDetails += ` href="${hrefAttr.length > 40 ? hrefAttr.slice(0, 37) + '...' : hrefAttr}"`;
        if (placeholder) extraDetails += ` placeholder="${placeholder}"`;
        if (ariaLabel) extraDetails += ` aria-label="${ariaLabel}"`;

        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          if (el.value) {
            extraDetails += ` value="${el.value.length > 30 ? el.value.slice(0, 27) + '...' : el.value}"`;
          }
          if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
            extraDetails += el.checked ? ' checked' : ' unchecked';
          }
          if (el.disabled) extraDetails += ' disabled';
        }

        const textSnippet = directText ? ` "${directText.length > 50 ? directText.slice(0, 47) + '...' : directText}"` : '';

        // Determine if node is semantic or interesting to display
        const isInteractive = ['a', 'button', 'input', 'select', 'textarea', 'dialog', 'summary'].includes(tag) || !!role;
        const isHeading = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag);
        const hasContent = directText.length > 0 || ariaLabel.length > 0 || !!id;
        const children = Array.from(el.children);

        // Compress generic wrapper divs/spans that have no text and only 1 child
        if (!isInteractive && !isHeading && !hasContent && children.length === 1) {
          return formatNode(children[0], currentDepth);
        }

        let locHint = '';
        if (isInteractive && !id) {
          if (ariaLabel) {
            locHint = ` loc="[aria-label='${ariaLabel}']"`;
          } else if (placeholder) {
            locHint = ` loc="[placeholder='${placeholder}']"`;
          } else if (directText && directText.length <= 30) {
            locHint = ` loc="text='${directText.replace(/"/g, '')}'"`;
          } else if (tag === 'a' && hrefAttr) {
            locHint = ` loc="a[href='${hrefAttr}']"`;
          }
        }

        const cs = window.getComputedStyle(el);
        let statusHint = '';
        if (cs.opacity === '0') {
          statusHint += ' [anim/opacity=0]';
        }
        if (rect.width > 0 && rect.height > 0 && (rect.right < 0 || rect.left > window.innerWidth || rect.bottom < 0 || rect.top > window.innerHeight)) {
          statusHint += ' [offscreen]';
        }

        lines.push(`${indent}- <${tag}${id}${className ? ' ' + className : ''}${compHint}${roleStr}${extraDetails}${statusHint}${locHint}>${textSnippet}${boxStr}`);

        for (const child of children) {
          lines.push(...formatNode(child, currentDepth + 1));
        }

        // Support open Shadow DOM traversal for Web Components (Lit, Shoelace, Ionic)
        if ((el as any).shadowRoot) {
          const shadowChildren = Array.from((el as any).shadowRoot.children) as Element[];
          if (shadowChildren.length > 0) {
            lines.push(`${indent}  - <#shadow-root>`);
            for (const sChild of shadowChildren) {
              lines.push(...formatNode(sChild, currentDepth + 2));
            }
          }
        }

        return lines;
      }

      const result = formatNode(root, 0);
      if (result.length > 0) return result.join('\n');
      if (rootSelector) {
        const cs = window.getComputedStyle(root);
        return `Element "${rootSelector}" found (<${root.tagName.toLowerCase()}>) but has no visible rendered children (display: ${cs.display}, visibility: ${cs.visibility}, opacity: ${cs.opacity}). Set includeOffscreen: true to inspect offscreen or animating elements.`;
      }
      return 'No visible rendered elements found.';
    },
    { rootSelector: selector, withBoxes: includeBoundingBox, depthLimit: maxDepth, withOffscreen: includeOffscreen, detectorScript: IN_BROWSER_COMPONENT_DETECTOR_FN }
  );
}
