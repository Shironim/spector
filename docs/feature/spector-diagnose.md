# Feature SSOT: Unified UI Forensics & Runtime Health (`spector_diagnose`)

Source: [src/tools/diagnose.ts](../../src/tools/diagnose.ts), [src/analyzers/layout-forensics.ts](../../src/analyzers/layout-forensics.ts), [src/analyzers/accessibility-forensics.ts](../../src/analyzers/accessibility-forensics.ts), [src/analyzers/token-audit.ts](../../src/analyzers/token-audit.ts), [src/analyzers/cdp-styles.ts](../../src/analyzers/cdp-styles.ts)

---

## 1. Overview

`spector_diagnose` is Spector's unified diagnostics tool, combining DOM layout anomaly scanning, CDP CSS cascade explanation, multi-breakpoint overflow audits, and active-tab runtime logs in a single operation.

---

## 2. Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `selector` | `string` | — | Optional CSS selector to run CDP `CSS.getMatchedStylesForNode` cascade analysis on (and responsive `targetLayout` when `breakpoints` is set). |
| `rootSelector` | `string` | — | Optional root CSS selector to scope layout forensics scanning (e.g. `"main"`, `"#checkout-modal"`) instead of scanning the entire `body`. Throws `ELEMENT_NOT_READY` if not found. |
| `maxElements` | `number` | `600` | Optional cap (`1..2500`) on visible elements visited during layout forensics. |
| `breakpoints` | `("mobile" \| "tablet" \| "desktop")[]` | — | Optional viewport presets to audit for horizontal overflow (`mobile=375x812`, `tablet=768x1024`, `desktop=1440x900`). Restores original viewport afterward. |
| `consoleLevel` | `"error" \| "warn" \| "all"` | `"error"` | Console severity filter. |
| `clearLogs` | `boolean` | `false` | Clears returned console and failed-network logs from buffer after analysis and budget checks succeed. Defaults to `false` so repeated diagnostic calls do not lose buffered evidence. |
| `includeCascade` | `boolean` | `true` | Runs CSS cascade inspection when `selector` is provided. |
| `includeAccessibility` | `boolean` | `true` | Runs WCAG AA contrast, missing accessible names, heading hierarchy, and mobile touch-target (`<44px`) audit. |
| `includeTokens` | `boolean` | `false` | Extracts frequency-sorted design-token distributions (typography, colors, radii, spacing, `:root` CSS variables) and `slopSignals`. |
| `cascadeProperties` | `string[]` | — | Optional CSS property list for `cssCascade` (defaults to core layout/visual properties). |
| `runtimeScope` | `"current-document" \| "active-tab" \| "browser-session"` | `"active-tab"` | Isolates `runtimeHealth` logs to the current navigation (`"current-document"` via `documentId`), active tab (`"active-tab"`), or all attached tabs (`"browser-session"`). |
| `detail` | `"compact" \| "full"` | `"compact"` | `"compact"` groups repetitive issues by normalized selector pattern (`:nth-of-type(*)`/`:nth-child(*)`) and trims repeated coverage boilerplate; `"full"` returns raw ungrouped issue arrays. |
| `viewport` | `"mobile" \| "tablet" \| "desktop"` | — | Optional viewport preset to emulate for the primary diagnosis (auto-restored afterward). |
| `colorScheme` | `"light" \| "dark"` | — | Optional `prefers-color-scheme` media emulation for the diagnosis (restored afterward). |
| `reducedMotion` | `boolean` | — | Optional `prefers-reduced-motion` media emulation for the diagnosis (restored afterward). |

---

## 3. Diagnostic Modules

### 3.1 Layout Anomaly Scanner (`layoutForensics`)
Scans visible light-DOM elements (`coverage.scope: "document-light-dom"` or `"scoped-light-dom"` when `rootSelector` is set), skipping Spector's own activity indicator as well as elements inside hidden ancestors (`display: none`, `visibility: hidden`, `content-visibility: hidden`) before counting toward `maxElements`. When total elements exceed `maxElements`, repetitive `tbody > tr` and `[role="rowgroup"] > [role="row"]` rows are sampled (first 3 + last 1) while preserving DOM order and reporting `skippedRepetitiveElements` in `coverage`:
- **Horizontal Overflow Culprits:** Elements exceeding `document.documentElement.clientWidth`.
- **Internal Horizontal Scroll (`internalHorizontalScroll`):** `overflow-x: auto|scroll` containers where `scrollWidth > clientWidth + 8` (with `hasTable` indicator).
- **Viewport & Container Clipping (`clippedInViewport`):** Interactive elements or `fixed`/`sticky` bars clipped by an `overflow: hidden|clip` ancestor (respecting intermediate scrollable containers) or by viewport edges on non-scrollable (`h-screen`) pages.
- **Clipping Traps:** `position: sticky` or content trapped under `overflow: hidden`/`clip` ancestors.
- **Z-Index Stacking Traps:** Unexpected stacking contexts obscuring elements.
- **Inactive / No-Op CSS Hints (`inactiveCss`):** Flags CSS properties that have no effect in their current layout context (e.g. `z-index`/`top`/`right`/`bottom`/`left` on `position: static`, `marginTop`/`marginBottom`/`minWidth`/`minHeight` on non-replaced `display: inline`, or `gap`/`justify-content`/`align-items` on non-flex/non-grid elements).
- **Broken Media & Fonts:** Broken visible `<img>`/`<svg>` elements (ignoring elements inside hidden ancestors) and errored or stalled web fonts.
- **DOM → Source File Mapping (`sourceFile`):** In dev mode, attaches sanitized relative source paths from Vue 3/Nuxt (`__vueParentComponent.type.__file`), React 17/18 (`_debugSource`), and React 19 (`_debugStack`).
- **Limits:** Issues are capped at `TOKEN_BUDGETS.MAX_DIAGNOSE_ISSUES` (`15`). Coverage metadata reports `candidateElements`, `visitedElements`, `skippedHiddenElements`, `skippedRepetitiveElements`, `elementLimitReached`, and `categoriesAtLimit`.

### 3.2 CSS Cascade Explainer (`cssCascade`)
When `selector` is provided and `includeCascade !== false`, queries CDP `CSS.getMatchedStylesForNode` and `CSS.getComputedStyleForNode` for tracked properties:
- **`resolution: "ranked"`:** Ranks matched author declarations by importance, inline style, `@layer` priority (including `!important` inversion), and CDP rule order. Deduplicates identical `overridden` entries and omits entries identical to the winner.
- **`resolution: "partial"`:** Returned when the top-ranked declaration is literal `revert` or `revert-layer`. Reports `limitation`, `computedValue`, and `authoredDeclarations` with an empty `overridden` list.
- **No Direct Author Match:** When `properties` is `{}` (no direct author rules matched tracked properties), includes a concise `note` and `computedSummary` of observed computed values so the result remains self-explanatory.
- **Pseudo-Elements (`pseudoElements`):** Processes `::before` and `::after` matches when author rules exist.

### 3.3 Multi-Breakpoint Overflow & Responsive Diff (`breakpointAudits`)
Runs `layoutForensics` (respecting `rootSelector` and `maxElements`) at each requested breakpoint (`mobile`, `tablet`, `desktop`) via `manager.withBreakpointMetrics(...)`, reporting `hasHorizontalOverflow`, `overflowCulpritsCount`, `topCulprit`, `internalHorizontalScrollCount`, `clippedInViewportCount`, and (for `mobile`) `touchTargetIssuesCount` + top-10 `touchTargetIssues` (grouped in compact mode), then restores the original viewport. When `selector` is also provided, each breakpoint entry includes `targetLayout` (`rect`, `display`, `flexDirection`, `gridTemplateColumns`, `fontSize`, `visibility`).

### 3.4 Before vs After Session Diff (`delta`)
Stores a lightweight bounded summary snapshot (FIFO, max 50 entries) per `(targetId, url, rootSelector, viewportKey)` in the active session after `enforceResponseBudget` succeeds. Subsequent runs on the same target return a `delta` block (`previousCapturedAt`, `changed`, and per-metric `{ before, after, diff }`).

### 3.5 Runtime Health (`runtimeHealth`)
- **Tab & Document Isolation:** Every log entry is tagged with `targetId`, `documentId`, and sanitized `pageUrl`. Use `runtimeScope: "current-document"` to isolate to the current navigation, `"active-tab"` (default) for the selected tab, or `"browser-session"` for all attached tabs.
- **Console Logs:** Consecutive identical messages are deduplicated with `(xN)`. Individual messages are capped at `8000` UTF-16 code units (`textTruncated`, `originalTextLength`), and query secrets in error locations are stripped.
- **Failed Network Requests:** Records only `status >= 400` or `requestfailed` in compact `METHOD STATUS pathname` format (max `200` chars pathname; query strings and bodies discarded).
- **Safe Buffer Consumption:** `clearLogs` defaults to `false`. When `clearLogs: true` is passed, draining occurs **only after** target validation, selector/cascade analysis, and `enforceResponseBudget` succeed.
