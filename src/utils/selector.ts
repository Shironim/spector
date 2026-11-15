const PSEUDO_CLASS_NAMES =
  'active|checked|disabled|empty|enabled|first-child|first-of-type|focus|focus-visible|focus-within|hover|last-child|last-of-type|not|nth-child|nth-last-child|nth-last-of-type|nth-of-type|only-child|root|target|visited';

const PSEUDO_RE = new RegExp(`^(?:${PSEUDO_CLASS_NAMES})(?:\\(|$)`);

/**
 * Escapes Tailwind CSS utility class characters (brackets, colons, slashes, dots, percents)
 * while preserving real CSS pseudo-classes such as :nth-of-type(2) or :hover.
 */
export function escapeTailwindSelector(selector: string): string {
  if (!selector) return selector;
  return selector.replace(
    /\.([a-zA-Z0-9_\-:/%]+(?:\.\d+)?(?:\[[^\]]+\][a-zA-Z0-9_\-:/%]*)?)/g,
    (_match, className) => {
      const escapedClass = className.replace(/(?<!\\)([:/\[\]#%.])/g, (char: string, _token: string, offset: number) => {
        if (char === ':' && PSEUDO_RE.test(className.slice(offset + 1))) {
          return char;
        }
        return `\\${char}`;
      });
      return '.' + escapedClass;
    }
  );
}

export const IN_BROWSER_CSS_SELECTOR_FN = `
function getCssSelector(el) {
  if (!el || el.nodeType !== 1) return '';
  if (el === document.documentElement) return 'html';
  if (el === document.body) return 'body';

  const isUnique = (sel) => {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };

  if (el.id) {
    const idSel = '#' + CSS.escape(el.id);
    if (isUnique(idSel)) return idSel;
  }

  for (const attr of ['data-testid', 'data-test', 'data-cy']) {
    const val = el.getAttribute(attr);
    if (val) {
      const attrSel = '[' + attr + '="' + CSS.escape(val) + '"]';
      if (isUnique(attrSel)) return attrSel;
    }
  }

  const path = [];
  let curr = el;
  while (curr && curr.nodeType === 1 && curr !== document.body && curr !== document.documentElement) {
    const tag = curr.tagName.toLowerCase();

    if (curr.id) {
      const idSel = '#' + CSS.escape(curr.id);
      if (isUnique(idSel)) {
        path.unshift(idSel);
        break;
      }
    }

    let matchedUniqueAttr = false;
    for (const attr of ['data-testid', 'data-test', 'data-cy']) {
      const val = curr.getAttribute(attr);
      if (val) {
        const attrSel = '[' + attr + '="' + CSS.escape(val) + '"]';
        if (isUnique(attrSel)) {
          path.unshift(attrSel);
          matchedUniqueAttr = true;
          break;
        }
      }
    }
    if (matchedUniqueAttr) break;

    const parent = curr.parentElement;
    if (!parent) {
      path.unshift(tag);
      break;
    }

    let classHint = '';
    if (curr.className && typeof curr.className === 'string') {
      const classes = curr.className
        .trim()
        .split(/\\s+/)
        .filter((c) => c && !c.includes(':') && !['flex', 'grid', 'hidden', 'block', 'inline', 'relative', 'absolute'].includes(c));
      if (classes.length > 0) {
        classHint = '.' + CSS.escape(classes[0]);
      }
    }

    const siblings = Array.from(parent.children).filter((c) => c.tagName.toLowerCase() === tag);
    if (siblings.length > 1) {
      const index = siblings.indexOf(curr) + 1;
      path.unshift(tag + classHint + ':nth-of-type(' + index + ')');
    } else {
      path.unshift(tag + classHint);
    }
    curr = parent;
  }

  return path.length > 0 ? path.join(' > ') : el.tagName.toLowerCase();
}
`;

export const IN_BROWSER_SANITIZE_PATH_FN = `
function sanitizeUrlPath(rawUrl) {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('data:')) return '[data-uri]';
  if (rawUrl.startsWith('blob:')) return '[blob-uri]';
  try {
    return new URL(rawUrl, window.location.href).pathname || rawUrl;
  } catch {
    return rawUrl.split('?')[0].split('#')[0];
  }
}
`;
