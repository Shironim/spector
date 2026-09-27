/**
 * In-browser Framework & Component Detector
 * Runs inside page.evaluate to extract React Fiber / Vue component metadata directly from DOM nodes.
 */

export interface DetectedFrameworkComponent {
  framework: 'vue' | 'react' | 'svelte' | 'angular' | 'unknown';
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

    curr = curr.parentElement;
  }

  return null;
}
`;
