# Feature SSOT: Unified UI Forensics & Runtime Health (`spector_diagnose`)

Source: [src/tools/diagnose.ts](../../src/tools/diagnose.ts), [src/analyzers/layout-forensics.ts](../../src/analyzers/layout-forensics.ts), [src/analyzers/cdp-styles.ts](../../src/analyzers/cdp-styles.ts), [src/analyzers/animation-forensics.ts](../../src/analyzers/animation-forensics.ts), [src/analyzers/accessibility-forensics.ts](../../src/analyzers/accessibility-forensics.ts)

---

## 1. Overview

`spector_diagnose` is Spector's unified diagnostics tool, combining DOM layout anomaly scanning, CDP CSS cascade explanation, multi-breakpoint overflow audits, and browser-session runtime logs in a single operation.

---

## 2. Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `selector` | `string` | — | Optional CSS selector to run CDP `CSS.getMatchedStylesForNode` cascade analysis on. |
| `breakpoints` | `("mobile" \| "tablet" \| "desktop")[]` | — | Optional viewport presets to audit for horizontal overflow (`mobile=375x812`, `tablet=768x1024`, `desktop=1440x900`). Restores original viewport afterward. |
| `consoleLevel` | `"error" \| "warn" \| "all"` | `"error"` | Console severity filter. |
| `clearLogs` | `boolean` | `true` | Clears returned console and failed-network logs from buffer after analysis and budget checks succeed. |
| `includeCascade` | `boolean` | `true` | Runs CSS cascade inspection when `selector` is provided. |
| `cascadeProperties` | `string[]` | — | Optional CSS property list for `cssCascade` (defaults to core layout/visual properties including `gap`, `grid-template-columns`, `border-radius`, `box-shadow`, `transform`, `line-height`). |
| `includeAnimations` | `boolean` | `true` | Extracts active CSS/WAAPI animations, timing, keyframes, and stagger patterns. |
| `includeAccessibility` | `boolean` | `true` | Runs CDP Accessibility tree missing-name check and bounded WCAG AA contrast audit. |
| `runtimeScope` | `"active-tab" \| "browser-session"` | `"active-tab"` | Isolates `runtimeHealth` logs to the active tab (`"active-tab"`) or returns logs across all attached tabs (`"browser-session"`). |
| `colorScheme` | `"light" \| "dark"` | — | Optional `prefers-color-scheme` media emulation for the diagnosis (restored afterward). |
| `reducedMotion` | `boolean` | — | Optional `prefers-reduced-motion` media emulation for the diagnosis (restored afterward). |

---

## 3. Diagnostic Modules

### 3.1 Layout Anomaly Scanner (`layoutForensics`)
Scans visible light-DOM elements (`coverage.scope: "document-light-dom"`, excluding Spector's own activity indicator) and reports:
- **Horizontal Overflow Culprits:** Elements exceeding `document.documentElement.clientWidth`.
- **Clipping Traps:** `position: sticky` or content trapped under `overflow: hidden`/`clip` ancestors.
- **Z-Index Stacking Traps:** Unexpected stacking contexts obscuring elements.
- **Inactive / No-Op CSS Hints (`inactiveCss`):** Flags CSS properties that have no effect in their current layout context (e.g. `z-index`/`top`/`right`/`bottom`/`left` on `position: static`, `marginTop`/`marginBottom`/`minWidth`/`minHeight` on non-replaced `display: inline`, or `gap`/`justify-content`/`align-items` on non-flex/non-grid elements).
- **Broken Media & Fonts:** Broken `<img>`/`<svg>` elements and errored or stalled web fonts.
- **Limits:** Issues are capped at `TOKEN_BUDGETS.MAX_DIAGNOSE_ISSUES` (`15`). Coverage metadata reports visited/candidate counts and limit indicators—empty findings are not a full-page audit certificate.

### 3.2 CSS Cascade Explainer (`cssCascade`)
When `selector` is provided and `includeCascade !== false`, queries CDP `CSS.getMatchedStylesForNode` and `CSS.getComputedStyleForNode` for tracked properties:
- **`resolution: "ranked"`:** Ranks matched author declarations by importance, inline style, `@layer` priority (including `!important` inversion), and CDP rule order. `winningValue` is authored CSS text, alongside observed `computedValue` when exposed by CDP (shorthands may be absent).
- **`resolution: "partial"`:** Returned when the top-ranked declaration is literal `revert` or `revert-layer` (including important, unlayered, and inline rollbacks). Reports `limitation`, `computedValue`, and `authoredDeclarations`, while omitting `winningValue`/`winningSource` and returning an empty `overridden` list because rollback provenance is unresolved.
- **Pseudo-Elements (`pseudoElements`):** Processes `::before` and `::after` matches when author rules exist (host `computedValue` is omitted on pseudo-elements).
- **Scope Limit:** Bounded explanation of matched author declarations—not a complete provenance engine for inheritance, user-agent rules, animation origins, or variable-dependent rollbacks.

### 3.3 Multi-Breakpoint Overflow & Responsive Diff (`breakpointAudits`)
Runs `layoutForensics` at each requested breakpoint (`mobile`, `tablet`, `desktop`) via `manager.withBreakpointMetrics(...)`, reporting `hasHorizontalOverflow`, `overflowCulpritsCount`, and `topCulprit`, then restores the original viewport. When `selector` is also provided, each breakpoint entry includes `targetLayout` (`rect`, `display`, `flexDirection`, `gridTemplateColumns`, `fontSize`, `visibility`) for structured responsive diffing without extra screenshots.

### 3.4 Animation & Motion Forensics (`animations`)
When `includeAnimations !== false` and active animations exist (scoped to `selector` if provided, otherwise document-wide), extracts WAAPI/CSS animations (`type`, `name`, `playState`, `durationMs`, `delayMs`, `iterations`, `easing`, `keyframes`), capped at `15` items, and detects consistent `staggerPatterns` (`stepMs`, `baseDelayMs`, `count`, `selectors`).

### 3.5 Accessibility & Contrast Forensics (`accessibility`)
When `includeAccessibility !== false`, runs two bounded checks (each capped at `MAX_DIAGNOSE_ISSUES = 15`):
- **Accessible Names (`missingNames`):** Uses CDP `Accessibility.getPartialAXTree` (when `selector` is given) or `getFullAXTree` to flag interactive controls (`button`, `link`, `textbox`, etc.) and `img`/`image` roles with empty accessible names.
- **WCAG AA Contrast (`contrastIssues`):** Scans up to `300` visible light-DOM text-bearing elements against their resolved ancestor background stack (`4.5:1` normal text, `3.0:1` large text `>= 24px` or `>= 18.66px` bold). Elements over `background-image`/gradients or ancestor `opacity < 1` are counted in `coverage.unverifiableContrastCount` rather than guessed.

### 3.6 Runtime Health (`runtimeHealth`)
- **Tab-Isolated by Default (`runtimeScope: "active-tab"`):** Filters console errors and failed network requests by the active tab's `targetId` (and prevents cross-tab deduplication merging). Pass `runtimeScope: "browser-session"` to inspect logs across all attached tabs.
- **Console Logs:** Consecutive identical messages are deduplicated with `(xN)`. Individual messages are capped at `8000` UTF-16 code units (`textTruncated`, `originalTextLength`), and query secrets in error locations are stripped.
- **Failed Network Requests:** Records only `status >= 400` or `requestfailed` in compact `METHOD STATUS pathname` format (max `200` chars pathname; query strings and bodies discarded).
- **Safe Buffer Consumption:** `clearLogs: true` is applied **only after** target validation, selector/cascade analysis, and `enforceResponseBudget` succeed, so a failed diagnosis never drains buffered evidence.
