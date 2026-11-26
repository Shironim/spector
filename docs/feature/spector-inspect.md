# Feature SSOT: Semantic DOM & Visual Screenshots (`spector_get_dom_tree`, `spector_capture_screenshot`)

Source: [src/tools/inspect.ts](../../src/tools/inspect.ts), [src/analyzers/dom-compressor.ts](../../src/analyzers/dom-compressor.ts), [src/utils/selector.ts](../../src/utils/selector.ts)

---

## 1. `spector_get_dom_tree` *(`--profile full` only)*

Extracts a token-lean semantic DOM tree for autonomous selector discovery and hierarchy inspection without dumping raw `outerHTML`.

### Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `selector` | `string` | — | Optional root CSS selector (arbitrary Tailwind classes like `.w-[200px]` are escaped automatically via `escapeTailwindSelector`). |
| `includeBoundingBox` | `boolean` | `true` | Includes pixel coordinates `[box=x,y,w,h]`. |
| `includeOffscreen` | `boolean` | `false` | Relaxes `opacity: 0` and zero-area filtering. Rendered elements outside the viewport are included in both modes and marked `[offscreen]`; this is not a viewport-only filter. |
| `maxDepth` | `number` | `8` | Maximum traversal depth (`0–64`, default `TELEMETRY_LIMITS.DOM_TREE_MAX_DEPTH`). |

### Compression, Security & Coverage
- **Tailwind-Aware Pruning:** Preserves relevant styling utility classes (capped at `20` classes / `220` chars per node) instead of stripping all classes.
- **Shadow DOM & Exclusions:** Traverses open Shadow DOM and excludes Spector's own `[data-spector-activity]` indicator.
- **Boxless Containers:** Traverses descendants of `display: contents`, zero-area, and `visibility: hidden` containers so visible descendants can be discovered. `display: none` subtrees remain excluded. Traversed wrappers count against node/depth limits even when omitted from the output.
- **Password Masking:** Strict value masking for `input[type="password"]` while preserving ordinary field values.
- **Coverage Header & Limits:** Output starts with metadata + a coverage header reporting any truncation (`MAX_DOM_NODES = 1000`, `MAX_DOM_CHARS = 64000`, depth/class/text/attribute limits).
- A truncated traversal still returns its coverage header when no node was emitted. Untruncated missing/empty roots return explanatory text instead of a coverage header.
- **Navigation Guard:** Rejects observed main-frame navigation (including reload to the same URL) during capture.

---

## 2. `spector_capture_screenshot`

Captures PNG screenshots of the active viewport, a target selector, the full scrollable page, or multiple responsive breakpoints.

### Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `selector` | `string` | — | Optional CSS selector to capture (element-scoped). |
| `expectedUrl` | `string` | — | Optional exact URL precondition (including query and fragment), verified before and after capture. |
| `fullPage` | `boolean` | `false` | Captures entire scrollable page height. |
| `breakpoints` | `("mobile" \| "tablet" \| "desktop")[]` | — | Responsive presets (`mobile=375x812`, `tablet=768x1024`, `desktop=1440x900`) via CDP Emulation. |
| `colorScheme` | `"light" \| "dark"` | — | Optional `prefers-color-scheme` media emulation for the capture (restored afterward). |
| `colorSchemes` | `("light" \| "dark")[]` | — | Optional batch of `prefers-color-scheme` themes to capture in one call (overrides `colorScheme`). |
| `reducedMotion` | `boolean` | — | Optional `prefers-reduced-motion` media emulation for the capture (restored afterward). |
| `hideDevtoolsOverlays` | `boolean` | `false` | Temporarily hides common framework DevTools overlays (Nuxt, Vue, Next.js, Vite, TanStack) via an atomic `<style data-spector-hide-overlay="true">` element and restores afterward. |
| `hideSelectors` | `string[]` | — | Optional CSS selectors to temporarily hide during screenshot capture and restore afterward. |

### Breakpoint & Safety Contract
- **Per-Breakpoint Partial Results:** If a `selector` is missing at one breakpoint (e.g. `.mobile-only` on `desktop`), that breakpoint records `ELEMENT_NOT_READY` while successful breakpoint images are still returned (`status: "partial"`).
- **Horizontal Overflow Check:** Each breakpoint reports `scrollWidth` vs `clientWidth` (`[OVERFLOW: ...]` or `[no horizontal overflow]`).
- **Viewport Restoration:** Original viewport and scroll state (when URL is unchanged) are restored after capture. A failed cleanup returns `VIEWPORT_RESTORE_FAILED` rather than treating captures as valid.
- **Pixel & Byte Caps:** Capped at `12,000,000` physical pixels (`MAX_SCREENSHOT_PIXELS`) and `6 MiB` PNG data (`MAX_SCREENSHOT_BYTES`). Exceeding a cap returns `RESOURCE_LIMIT_EXCEEDED`.
