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
| `runtimeScope` | `"active-tab" \| "browser-session"` | `"active-tab"` | Isolates `runtimeHealth` logs to the active tab (`"active-tab"`) or returns logs across all attached tabs (`"browser-session"`). |
| `colorScheme` | `"light" \| "dark"` | — | Optional `prefers-color-scheme` media emulation for the diagnosis (restored afterward). |
| `reducedMotion` | `boolean` | — | Optional `prefers-reduced-motion` media emulation for the diagnosis (restored afterward). |

---

## 3. Diagnostic Modules

### 3.1 Layout Anomaly Scanner (`layoutForensics`)
Scans visible light-DOM elements (`coverage.scope: "document-light-dom"` or `"scoped-light-dom"` when `rootSelector` is set), skipping Spector's own activity indicator as well as elements inside hidden ancestors (`display: none`, `visibility: hidden`, `content-visibility: hidden`) before counting toward `maxElements`:
- **Horizontal Overflow Culprits:** Elements exceeding `document.documentElement.clientWidth`.
- **Clipping Traps:** `position: sticky` or content trapped under `overflow: hidden`/`clip` ancestors.
- **Z-Index Stacking Traps:** Unexpected stacking contexts obscuring elements.
- **Inactive / No-Op CSS Hints (`inactiveCss`):** Flags CSS properties that have no effect in their current layout context (e.g. `z-index`/`top`/`right`/`bottom`/`left` on `position: static`, `marginTop`/`marginBottom`/`minWidth`/`minHeight` on non-replaced `display: inline`, or `gap`/`justify-content`/`align-items` on non-flex/non-grid elements).
- **Broken Media & Fonts:** Broken visible `<img>`/`<svg>` elements (ignoring elements inside hidden ancestors) and errored or stalled web fonts.
- **Limits:** Issues are capped at `TOKEN_BUDGETS.MAX_DIAGNOSE_ISSUES` (`15`). Coverage metadata reports `candidateElements`, `visitedElements`, `skippedHiddenElements`, `elementLimitReached`, and `categoriesAtLimit`.

### 3.2 CSS Cascade Explainer (`cssCascade`)
When `selector` is provided and `includeCascade !== false`, queries CDP `CSS.getMatchedStylesForNode` and `CSS.getComputedStyleForNode` for tracked properties:
- **`resolution: "ranked"`:** Ranks matched author declarations by importance, inline style, `@layer` priority (including `!important` inversion), and CDP rule order. Deduplicates identical `overridden` entries and omits entries identical to the winner.
- **`resolution: "partial"`:** Returned when the top-ranked declaration is literal `revert` or `revert-layer`. Reports `limitation`, `computedValue`, and `authoredDeclarations` with an empty `overridden` list.
- **No Direct Author Match:** When `properties` is `{}` (no direct author rules matched tracked properties), includes a concise `note` and `computedSummary` of observed computed values so the result remains self-explanatory.
- **Pseudo-Elements (`pseudoElements`):** Processes `::before` and `::after` matches when author rules exist.

### 3.3 Multi-Breakpoint Overflow & Responsive Diff (`breakpointAudits`)
Runs `layoutForensics` (respecting `rootSelector` and `maxElements`) at each requested breakpoint (`mobile`, `tablet`, `desktop`) via `manager.withBreakpointMetrics(...)`, reporting `hasHorizontalOverflow`, `overflowCulpritsCount`, and `topCulprit`, then restores the original viewport. When `selector` is also provided, each breakpoint entry includes `targetLayout` (`rect`, `display`, `flexDirection`, `gridTemplateColumns`, `fontSize`, `visibility`).

### 3.4 Runtime Health (`runtimeHealth`)
- **Tab-Isolated by Default (`runtimeScope: "active-tab"`):** Filters console errors and failed network requests by the active tab's `targetId`.
- **Console Logs:** Consecutive identical messages are deduplicated with `(xN)`. Individual messages are capped at `8000` UTF-16 code units (`textTruncated`, `originalTextLength`), and query secrets in error locations are stripped.
- **Failed Network Requests:** Records only `status >= 400` or `requestfailed` in compact `METHOD STATUS pathname` format (max `200` chars pathname; query strings and bodies discarded).
- **Safe Buffer Consumption:** `clearLogs` defaults to `false`. When `clearLogs: true` is passed, draining occurs **only after** target validation, selector/cascade analysis, and `enforceResponseBudget` succeed.
