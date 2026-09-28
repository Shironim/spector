/**
 * In-browser Framework & Component Detector
 * Runs inside page.evaluate to extract React Fiber / Vue component metadata directly from DOM nodes.
 */

export interface DetectedFrameworkComponent {
  framework: 'vue' | 'react' | 'svelte' | 'angular' | 'livewire' | 'alpine' | 'inertia' | 'blade' | 'unknown';
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  props?: string[];
}

/**
 * Client-side script string to be injected or run inside browser execution context.
 */
export const IN_BROWSER_COMPONENT_DETECTOR_FN = `
function detectFrameworkComponent(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;

  let curr = el;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    // 1. Vue 3 detection (__vueParentComponent)
    if (curr.__vueParentComponent) {
      const comp = curr.__vueParentComponent;
      const type = comp.type || {};
      const file = type.__file || comp.subTree?.type?.__file;
      const rawName = type.__name || type.name || (file ? file.split(/[\\\\/]/).pop().replace(/\\.\\w+$/, '') : null);
      const name = rawName && rawName !== 'Anonymous' ? rawName : undefined;
      const props = comp.props ? Object.keys(comp.props).filter(k => !k.startsWith('__')) : undefined;

      return {
        framework: 'vue',
        componentName: name,
        sourceFile: file,
        props: props && props.length > 0 ? props.slice(0, 10) : undefined
      };
    }

    // 2. Vue 2 detection (__vue__)
    if (curr.__vue__) {
      const comp = curr.__vue__;
      const options = comp.$options || {};
      const name = options._componentTag || options.name || (options.__file ? options.__file.split(/[\\\\/]/).pop().replace(/\\.\\w+$/, '') : null);
      return {
        framework: 'vue',
        componentName: name || undefined,
        sourceFile: options.__file
      };
    }

    // 3. React Fiber detection (__reactFiber$ or __reactInternalInstance$)
    const fiberKey = Object.keys(curr).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (fiberKey) {
      let fiber = curr[fiberKey];
      while (fiber) {
        if (typeof fiber.type === 'function' || (fiber.type && typeof fiber.type === 'object')) {
          const name = fiber.type.displayName || fiber.type.name;
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
    }

    // 4. Svelte detection (__svelte_meta)
    if (curr.__svelte_meta) {
      const meta = curr.__svelte_meta;
      const file = meta.loc?.file;
      const name = file ? file.split(/[\\\\/]/).pop().replace(/\\.\\w+$/, '') : undefined;
      return {
        framework: 'svelte',
        componentName: name,
        sourceFile: file,
        sourceLine: meta.loc?.line
      };
    }

    // 5. Livewire detection (wire:id / wire:snapshot / wire:initial-data)
    if (curr.hasAttribute('wire:id') || curr.hasAttribute('wire:snapshot') || curr.hasAttribute('wire:initial-data')) {
      let compName = undefined;
      const snapshot = curr.getAttribute('wire:snapshot');
      if (snapshot) {
        try {
          const parsed = JSON.parse(snapshot);
          compName = parsed.memo?.name;
        } catch {
          // Ignore
        }
      }
      if (!compName) {
        const initData = curr.getAttribute('wire:initial-data');
        if (initData) {
          try {
            const parsed = JSON.parse(initData);
            compName = parsed.fingerprint?.name;
          } catch {
            // Ignore
          }
        }
      }
      return {
        framework: 'livewire',
        componentName: compName || curr.getAttribute('wire:id') || 'LivewireComponent'
      };
    }

    // 6. Inertia.js detection ([data-page])
    const inertiaPageEl = curr.hasAttribute('data-page') ? curr : (curr.id === 'app' && curr.hasAttribute('data-page') ? curr : null);
    if (inertiaPageEl) {
      try {
        const dataPage = JSON.parse(inertiaPageEl.getAttribute('data-page') || '{}');
        if (dataPage.component) {
          return {
            framework: 'inertia',
            componentName: dataPage.component,
            sourceFile: 'resources/js/Pages/' + dataPage.component + '.vue'
          };
        }
      } catch {
        // Ignore
      }
    }

    // 7. Alpine.js detection (x-data)
    if (curr.hasAttribute('x-data')) {
      const xDataVal = curr.getAttribute('x-data')?.trim();
      const compName = xDataVal && xDataVal.length <= 40 ? xDataVal : 'AlpineComponent';
      return {
        framework: 'alpine',
        componentName: compName
      };
    }

    // 8. Blade Comment / HTML Comment Sniffer (View: / @feature / resources/views)
    let sib = curr.previousSibling;
    let commentChecks = 0;
    while (sib && commentChecks < 5) {
      if (sib.nodeType === Node.COMMENT_NODE && sib.textContent) {
        const text = sib.textContent.trim();
        const match = text.match(/(?:View|Blade|Component|File|Template):\\s*([^\\s->]+)/i) ||
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
      commentChecks++;
    }

    curr = curr.parentElement;
  }

  return null;
}
`;
