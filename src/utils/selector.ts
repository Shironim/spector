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

export const IN_BROWSER_SOURCE_FILE_FN = `
function sanitizeSourceFile(rawFile, lineNumber) {
  if (!rawFile || typeof rawFile !== 'string') return undefined;
  const normalized = rawFile.replace(/\\\\/g, '/').replace(/^file:\\/\\//, '');
  const withLeadingSlash = normalized.startsWith('/') ? normalized : '/' + normalized;
  const markers = ['/app/', '/src/', '/pages/', '/components/', '/layouts/', '/views/', '/features/', '/modules/', '/widgets/'];
  let shortPath = normalized;
  for (const marker of markers) {
    const idx = withLeadingSlash.lastIndexOf(marker);
    if (idx !== -1) {
      shortPath = withLeadingSlash.slice(idx + 1);
      break;
    }
  }
  if (shortPath === normalized && normalized.startsWith('/')) {
    const parts = normalized.split('/').filter(Boolean);
    shortPath = parts.slice(-4).join('/');
  }
  if (typeof lineNumber === 'number' && Number.isFinite(lineNumber) && lineNumber > 0) {
    return shortPath + ':' + Math.round(lineNumber);
  }
  return shortPath || undefined;
}

function getSourceFile(el) {
  if (!el || el.nodeType !== 1) return undefined;
  let curr = el;
  let fallbackFile;
  for (let depth = 0; curr && depth < 12; depth++) {
    // Vue 3 / Nuxt dev metadata
    const vueComp = curr.__vueParentComponent;
    if (vueComp) {
      let vc = vueComp;
      for (let vDepth = 0; vc && vDepth < 8; vDepth++) {
        const raw = vc.type && vc.type.__file;
        if (typeof raw === 'string' && raw) {
          if (!raw.includes('node_modules')) {
            return sanitizeSourceFile(raw);
          }
          if (!fallbackFile) fallbackFile = sanitizeSourceFile(raw);
        }
        vc = vc.parent;
      }
    }

    // React Fiber dev metadata (React 17/18 _debugSource + React 19 _debugStack)
    const keys = Object.keys(curr);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
        let fiber = curr[key];
        for (let fDepth = 0; fiber && fDepth < 12; fDepth++) {
          const src = fiber._debugSource || (fiber._debugOwner && fiber._debugOwner._debugSource);
          if (src && typeof src.fileName === 'string' && src.fileName) {
            if (!src.fileName.includes('node_modules')) {
              return sanitizeSourceFile(src.fileName, src.lineNumber);
            }
            if (!fallbackFile) fallbackFile = sanitizeSourceFile(src.fileName, src.lineNumber);
          }
          // React 19 removed _debugSource in favor of _debugStack (Error with JSX callsite stack)
          const stack = (fiber._debugStack && typeof fiber._debugStack.stack === 'string' && fiber._debugStack.stack) ||
            (fiber._debugOwner && fiber._debugOwner._debugStack && typeof fiber._debugOwner._debugStack.stack === 'string' && fiber._debugOwner._debugStack.stack);
          if (stack) {
            const lines = stack.split('\\n');
            for (let li = 0; li < lines.length; li++) {
              const m = lines[li].match(/(?:https?:\\/\\/[^\\/\\s)]+\\/|file:\\/\\/|\\()([^\\s():]+\\.(?:[jt]sx?|mjs|cjs)):(\\d+)/);
              if (m && m[1] && !m[1].includes('node_modules') && !m[1].includes('react-dom')) {
                return sanitizeSourceFile(m[1], Number(m[2]));
              }
            }
          }
          fiber = fiber.return;
        }
        break;
      }
    }

    curr = curr.parentElement;
  }
  return fallbackFile;
}
`;

export function normalizeSelectorPattern(selector: string): string {
  if (!selector) return selector;
  return selector
    .replace(/:nth-of-type\(\d+\)/g, ':nth-of-type(*)')
    .replace(/:nth-child\(\d+\)/g, ':nth-child(*)');
}
