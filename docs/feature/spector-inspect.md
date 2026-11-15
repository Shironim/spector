# Feature SSOT: Semantic DOM & Visual Screenshots (`spector_get_dom_tree`, `spector_capture_screenshot`)

Source: [src/tools/inspect.ts](../../src/tools/inspect.ts), [src/analyzers/dom-compressor.ts](../../src/analyzers/dom-compressor.ts), [src/utils/selector.ts](../../src/utils/selector.ts)

---

## 1. `spector_get_dom_tree`

Extracts a token-lean semantic DOM tree for autonomous selector discovery and hierarchy inspection without dumping raw `outerHTML`.

### Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `selector` | `string` | — | Optional root CSS selector (arbitrary Tailwind classes like `.w-[200px]` are escaped automatically via `escapeTailwindSelector`). |
| `includeBoundingBox` | `boolean` | `true` | Includes pixel coordinates `[box=x,y,w,h]`. |
| `includeOffscreen` | `boolean` | `false` | Includes elements outside the active viewport or animating from `opacity: 0`. |
| `maxDepth` | `number` | `8` | Maximum traversal depth (`0–64`, default `TELEMETRY_LIMITS.DOM_TREE_MAX_DEPTH`). |

### Compression, Security & Coverage
- **Tailwind-Aware Pruning:** Preserves relevant styling utility classes (capped at `20` classes / `220` chars per node) instead of stripping all classes.
- **Shadow DOM & Exclusions:** Traverses open Shadow DOM and excludes Spector's own `[data-spector-activity]` indicator.
- **Password Masking:** Strict value masking for `input[type="password"]` while preserving ordinary field values.
- **Coverage Header & Limits:** Output starts with metadata + a coverage header reporting any truncation (`MAX_DOM_NODES = 1000`, `MAX_DOM_CHARS = 64000`, depth/class/text/attribute limits).
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

### Breakpoint & Safety Contract
- **Per-Breakpoint Partial Results:** If a `selector` is missing at one breakpoint (e.g. `.mobile-only` on `desktop`), that breakpoint records `ELEMENT_NOT_READY` while successful breakpoint images are still returned (`status: "partial"`).
- **Horizontal Overflow Check:** Each breakpoint reports `scrollWidth` vs `clientWidth` (`[OVERFLOW: ...]` or `[no horizontal overflow]`).
- **Viewport Restoration:** Original viewport and scroll state (when URL is unchanged) are restored after capture. A failed cleanup returns `VIEWPORT_RESTORE_FAILED` rather than treating captures as valid.
- **Pixel & Byte Caps:** Capped at `12,000,000` physical pixels (`MAX_SCREENSHOT_PIXELS`) and `6 MiB` PNG data (`MAX_SCREENSHOT_BYTES`). Exceeding a cap returns `RESOURCE_LIMIT_EXCEEDED`.
