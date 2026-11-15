import type { FrameworkComponentInfo } from '../types.js';

/**
 * Pure string normalizer for dev-server component paths (no filesystem access).
 */
export function normalizeSourceFile(rawSourceFile?: string): string | undefined {
  if (!rawSourceFile || typeof rawSourceFile !== 'string') return undefined;

  let cleaned = rawSourceFile
    .trim()
    .replace(/\?.*$/, '')
    .replace(/#.*$/, '')
    .replace(/^[a-zA-Z]+:\/\/[^/]+/, '');

  if (!cleaned) return undefined;

  if (cleaned.startsWith('/@fs/')) {
    const rest = cleaned.slice(5);
    cleaned = /^[a-zA-Z]:[/\\]/.test(rest) ? rest : `/${rest.replace(/^\/+/, '')}`;
  }

  cleaned = cleaned.replace(/\\/g, '/');

  if (/^\/([a-zA-Z]:\/)/.test(cleaned)) {
    cleaned = cleaned.slice(1);
  }

  cleaned = cleaned
    .replace(/^\/resources\//, 'resources/')
    .replace(/^\/src\//, 'src/')
    .replace(/^\/app\//, 'app/')
    .replace(/^\/components\//, 'components/')
    .replace(/^\/pages\//, 'pages/');

  return cleaned || undefined;
}

export function enrichFrameworkComponent(
  component?: FrameworkComponentInfo | null
): FrameworkComponentInfo | undefined {
  if (!component) return undefined;
  const cleanedPath = normalizeSourceFile(component.sourceFile);
  return {
    ...component,
    ...(cleanedPath ? { sourceFile: cleanedPath } : {})
  };
}

export const IN_BROWSER_COMPONENT_DETECTOR_FN = `
function detectVueComponent(curr) {
  if (curr.__vueParentComponent) {
    let comp = curr.__vueParentComponent;
    const seen = new Set();
    while (comp && !seen.has(comp) && seen.size < 1000) {
      seen.add(comp);
      const type = comp.type || {};
      const file = type.__file || comp.subTree?.type?.__file;
      const rawName = type.__name || type.name || (file ? file.split(/[\\\\/]/).pop().replace(/\\.\\w+$/, '') : null);
      const name = rawName && rawName !== 'Anonymous' ? rawName : undefined;
      if (name || file) {
        const props = comp.props ? Object.keys(comp.props).filter(k => !k.startsWith('__')) : undefined;
        return {
          framework: 'vue',
          componentName: name,
          sourceFile: file,
          props: props && props.length > 0 ? props.slice(0, 10) : undefined
        };
      }
      comp = comp.parent;
    }
  }
  if (curr.__vue__) {
    const options = curr.__vue__.$options || {};
    const name = options._componentTag || options.name || (options.__file ? options.__file.split(/[\\\\/]/).pop().replace(/\\.\\w+$/, '') : null);
    return {
      framework: 'vue',
      componentName: name || undefined,
      sourceFile: options.__file
    };
  }
  return null;
}

function detectReactComponent(curr) {
  const fiberKey = Object.keys(curr).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (!fiberKey) return null;
  let fiber = curr[fiberKey];
  const seen = new Set();
  while (fiber && !seen.has(fiber) && seen.size < 1000) {
    seen.add(fiber);
    if (typeof fiber.type === 'function' || (fiber.type && typeof fiber.type === 'object')) {
      const name =
        fiber.type.displayName ||
        fiber.type.name ||
        fiber.type.type?.displayName ||
        fiber.type.type?.name ||
        fiber.type.render?.displayName ||
        fiber.type.render?.name;
      if (name && name !== 'Anonymous') {
        const source = fiber._debugSource;
        const props = fiber.memoizedProps ? Object.keys(fiber.memoizedProps).filter(k => k !== 'children') : undefined;
        return {
          framework: 'react',
          componentName: name,
          sourceFile: source?.fileName,
          sourceLine: source?.lineNumber,
          props: props && props.length > 0 ? props.slice(0, 10) : undefined
        };
      }
    }
    fiber = fiber.return;
  }
  return null;
}

function detectSvelteComponent(curr) {
  if (!curr.__svelte_meta) return null;
  const meta = curr.__svelte_meta;
  const file = meta.loc?.file;
  return {
    framework: 'svelte',
    componentName: file ? file.split(/[\\\\/]/).pop().replace(/\\.\\w+$/, '') : undefined,
    sourceFile: file,
    sourceLine: meta.loc?.line
  };
}

function parseJsonAttr(el, attr) {
  const raw = el.getAttribute(attr);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detectLivewireComponent(curr) {
  if (!curr.hasAttribute('wire:id') && !curr.hasAttribute('wire:snapshot') && !curr.hasAttribute('wire:initial-data')) {
    return null;
  }
  const snapName = parseJsonAttr(curr, 'wire:snapshot')?.memo?.name;
  const initName = snapName || parseJsonAttr(curr, 'wire:initial-data')?.fingerprint?.name;
  return {
    framework: 'livewire',
    componentName: initName || curr.getAttribute('wire:id') || 'LivewireComponent'
  };
}

function detectInertiaComponent(curr) {
  if (!curr.hasAttribute('data-page')) return null;
  const dataPage = parseJsonAttr(curr, 'data-page');
  if (!dataPage?.component) return null;
  return {
    framework: 'inertia',
    componentName: dataPage.component,
    sourceFile: 'resources/js/Pages/' + dataPage.component
  };
}

function detectAlpineComponent(curr) {
  if (!curr.hasAttribute('x-data')) return null;
  const xDataVal = curr.getAttribute('x-data')?.trim();
  return {
    framework: 'alpine',
    componentName: xDataVal && xDataVal.length <= 40 ? xDataVal : 'AlpineComponent'
  };
}

function detectBladeCommentHint(curr) {
  let sib = curr.previousSibling;
  let checks = 0;
  while (sib && checks < 5) {
    if (sib.nodeType === 8 && sib.textContent) {
      const text = sib.textContent.trim();
      const match =
        text.match(/(?:View|Blade|Component|File|Template):\\s*([^\\s->]+)/i) ||
        text.match(/@feature\\s+([^\\s->]+)/i) ||
        text.match(/resources\\/views\\/[^\\s->]+/i);
      if (match) {
        const resolved = match[1] || match[0];
        return {
          framework: 'blade',
          componentName: resolved.split(/[\\\\/]/).pop().replace(/\\.blade\\.php$/, ''),
          sourceFile: resolved
        };
      }
    }
    sib = sib.previousSibling;
    checks++;
  }
  return null;
}

const FRAMEWORK_DETECTORS = [
  detectVueComponent,
  detectReactComponent,
  detectSvelteComponent,
  detectLivewireComponent,
  detectInertiaComponent,
  detectAlpineComponent,
  detectBladeCommentHint
];

function detectFrameworkComponent(el) {
  if (!el || el.nodeType !== 1) return null;
  let curr = el;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    for (let i = 0; i < FRAMEWORK_DETECTORS.length; i++) {
      const hit = FRAMEWORK_DETECTORS[i](curr);
      if (hit) return hit;
    }
    curr = curr.parentElement;
  }
  return null;
}
`;
