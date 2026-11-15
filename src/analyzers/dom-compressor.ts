import type { Page } from 'playwright-core';
import { IN_BROWSER_COMPONENT_DETECTOR_FN } from '../utils/framework-detector.js';
import { TELEMETRY_LIMITS, TOKEN_BUDGETS } from '../constants.js';

export interface DomTreeOptions {
  selector?: string;
  includeBoundingBox?: boolean;
  maxDepth?: number;
  includeOffscreen?: boolean;
}

export async function extractCompressedDom(page: Page, options: DomTreeOptions = {}): Promise<string> {
  const {
    selector,
    includeBoundingBox = true,
    maxDepth = TELEMETRY_LIMITS.DOM_TREE_MAX_DEPTH,
    includeOffscreen = false
  } = options;

  const args = {
    rootSelector: selector ?? null,
    withBoxes: includeBoundingBox,
    depthLimit: maxDepth,
    withOffscreen: includeOffscreen,
    maxClasses: TOKEN_BUDGETS.MAX_CLASSES_PER_NODE,
    maxClassChars: TOKEN_BUDGETS.MAX_CLASS_CHARS_PER_NODE,
    maxNodes: TOKEN_BUDGETS.MAX_DOM_NODES, maxChars: TOKEN_BUDGETS.MAX_DOM_CHARS
  };

  // Run via serialized IIFE so strict CSP pages blocking unsafe-eval evaluate DOM cleanly.
  const script = `(() => {
    const { rootSelector, withBoxes, depthLimit, withOffscreen, maxClasses, maxClassChars, maxNodes, maxChars } = ${JSON.stringify(args)};
    let visitedNodes = 0;
    const truncated = new Set();
    ${IN_BROWSER_COMPONENT_DETECTOR_FN}

    const root = rootSelector ? document.querySelector(rootSelector) : document.body;
    if (!root) {
      return 'Error: Root element not found for selector "' + (rootSelector || 'body') + '".';
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

    function isVisible(el) {
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
        (typeof el.className === 'string' && /\\b(fade|aos|animate|transition|slide)\\b/i.test(el.className));

      if (style.opacity === '0' && !hasAnim && !withOffscreen) {
        return false;
      }

      const rect = el.getBoundingClientRect();
      if (withOffscreen) {
        return rect.width > 0 || rect.height > 0 || el.children.length > 0;
      }

      return (rect.width > 0 && rect.height > 0) || (hasAnim && el.children.length > 0);
    }

    function getDirectText(el) {
      let text = '';
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const trimmed = child.textContent && child.textContent.trim();
          if (trimmed) text += trimmed + ' ';
        }
      }
      return text.trim();
    }

    function formatClasses(el) {
      const rawClass = el instanceof HTMLElement ? el.className : el.getAttribute('class');
      if (!rawClass || typeof rawClass !== 'string') return '';
      const tokens = rawClass.trim().split(/\\s+/).filter(Boolean);
      if (tokens.length === 0) return '';

      const kept = [];
      let totalLen = 0;
      for (const token of tokens) {
        if (kept.length >= maxClasses) break;
        const piece = '.' + token;
        if (totalLen + piece.length > maxClassChars) break;
        kept.push(piece);
        totalLen += piece.length;
      }
      if (kept.length < tokens.length) truncated.add('CLASS_LIMIT');
      const suffix = kept.length < tokens.length ? '(+' + (tokens.length - kept.length) + ')' : '';
      return kept.join('') + suffix;
    }

    function formatNode(el, currentDepth) {
      if (el.hasAttribute('data-spector-activity')) return [];
      if (currentDepth > depthLimit) { truncated.add('DEPTH_LIMIT'); return []; }
      if (visitedNodes >= maxNodes) { truncated.add('NODE_LIMIT'); return []; }
      visitedNodes++;
      if (IGNORED_TAGS.has(el.tagName)) return [];
      if (!isVisible(el)) return [];

      const lines = [];
      const indent = '  '.repeat(currentDepth);
      const tag = el.tagName.toLowerCase();

      if (tag === 'svg') {
        const rect = el.getBoundingClientRect();
        const boxStr = withBoxes
          ? ' [box=' + Math.round(rect.x) + ',' + Math.round(rect.y) + ',' + Math.round(rect.width) + ',' + Math.round(rect.height) + ']'
          : '';
        const titleEl = el.querySelector && el.querySelector('title');
        const ariaLabel = el.getAttribute('aria-label') || (titleEl ? titleEl.textContent : '') || '';
        const labelStr = ariaLabel ? ' "' + ariaLabel.trim() + '"' : '';
        lines.push(indent + '- <svg>' + labelStr + boxStr);
        return lines;
      }

      const role = el.getAttribute('role') || '';
      const id = el.id ? '#' + el.id : '';
      const classStr = formatClasses(el);

      // Detect framework component ONLY on the root node (avoids per-node tree walks)
      const comp = currentDepth === 0 && typeof detectFrameworkComponent === 'function' ? detectFrameworkComponent(el) : null;
      const compHint = comp && comp.componentName ? ' [' + comp.framework + ':' + comp.componentName + ']' : '';

      const rect = el.getBoundingClientRect();
      const boxStr = withBoxes
        ? ' [box=' + Math.round(rect.x) + ',' + Math.round(rect.y) + ',' + Math.round(rect.width) + ',' + Math.round(rect.height) + ']'
        : '';

      const roleStr = role ? ' role="' + role + '"' : '';
      const directText = getDirectText(el);
      const ariaLabel = el.getAttribute('aria-label') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const typeAttr = el.getAttribute('type') || '';
      const hrefAttr = el.getAttribute('href') || '';
      if (hrefAttr.length > 40) truncated.add('ATTRIBUTE_LIMIT');

      let extraDetails = '';
      if (typeAttr) extraDetails += ' type="' + typeAttr + '"';
      if (hrefAttr) extraDetails += ' href="' + (hrefAttr.length > 40 ? hrefAttr.slice(0, 37) + '...' : hrefAttr) + '"';
      if (placeholder) extraDetails += ' placeholder="' + placeholder + '"';
      if (ariaLabel) extraDetails += ' aria-label="' + ariaLabel + '"';

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        const inputType = (el instanceof HTMLInputElement ? (el.type || typeAttr) : '').toLowerCase();
        if (el.value && inputType !== 'password') {
          if (el.value.length > 30) truncated.add('ATTRIBUTE_LIMIT');
          extraDetails += ' value="' + (el.value.length > 30 ? el.value.slice(0, 27) + '...' : el.value) + '"';
        }
        if (el instanceof HTMLInputElement && (inputType === 'checkbox' || inputType === 'radio')) {
          extraDetails += el.checked ? ' checked' : ' unchecked';
        }
        if (el.disabled) extraDetails += ' disabled';
      }

      const textSnippet = directText ? ' "' + (directText.length > 50 ? directText.slice(0, 47) + '...' : directText) + '"' : '';
      if (directText.length > 50) truncated.add('TEXT_LIMIT');

      const isInteractive = ['a', 'button', 'input', 'select', 'textarea', 'dialog', 'summary'].includes(tag) || !!role;
      const isHeading = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag);
      const hasContent = directText.length > 0 || ariaLabel.length > 0 || !!id || !!(comp && comp.componentName);
      const children = Array.from(el.children);

      if (!isInteractive && !isHeading && !hasContent && !classStr && children.length === 1) {
        return formatNode(children[0], currentDepth);
      }

      const cs = window.getComputedStyle(el);
      let statusHint = '';
      if (cs.opacity === '0') {
        statusHint += ' [anim/opacity=0]';
      }
      if (rect.width > 0 && rect.height > 0 && (rect.right < 0 || rect.left > window.innerWidth || rect.bottom < 0 || rect.top > window.innerHeight)) {
        statusHint += ' [offscreen]';
      }

      lines.push(indent + '- <' + tag + id + (classStr ? ' ' + classStr : '') + compHint + roleStr + extraDetails + statusHint + '>' + textSnippet + boxStr);

      for (const child of children) {
        if (visitedNodes >= maxNodes) { truncated.add('NODE_LIMIT'); break; }
        lines.push(...formatNode(child, currentDepth + 1));
      }

      if (el.shadowRoot) {
        const shadowChildren = Array.from(el.shadowRoot.children);
        if (shadowChildren.length > 0) {
          lines.push(indent + '  - <#shadow-root>');
          for (const sChild of shadowChildren) {
            if (visitedNodes >= maxNodes) { truncated.add('NODE_LIMIT'); break; }
            lines.push(...formatNode(sChild, currentDepth + 2));
          }
        }
      }

      return lines;
    }

    const result = formatNode(root, 0);
    if (result.length > 0) {
      let text = result.join('\\n');
      if (text.length > maxChars) { text = text.slice(0, maxChars); truncated.add('CHAR_LIMIT'); }
      return '[DOM coverage: ' + JSON.stringify({ scope: rootSelector || 'body', visitedNodes, nodeLimit: maxNodes, depthLimit, truncation: Array.from(truncated), excluded: ['iframe-documents', 'closed-shadow-roots', 'hidden-elements', 'non-semantic-tags'] }) + ']\\n' + text;
    }
    if (rootSelector) {
      const cs = window.getComputedStyle(root);
      return 'Element "' + rootSelector + '" found (<' + root.tagName.toLowerCase() + '>) but has no visible rendered children (display: ' + cs.display + ', visibility: ' + cs.visibility + ', opacity: ' + cs.opacity + '). Set includeOffscreen: true to inspect offscreen or animating elements.';
    }
    return 'No visible rendered elements found.';
  })()`;

  return await page.evaluate(script);
}
