# Feature SSOT: Unified UI Forensics & Runtime Health (`spector_diagnose`)

Source: [src/tools/diagnose.ts](../../src/tools/diagnose.ts), [src/analyzers/layout-forensics.ts](../../src/analyzers/layout-forensics.ts), [src/analyzers/cdp-styles.ts](../../src/analyzers/cdp-styles.ts), [src/analyzers/animation-forensics.ts](../../src/analyzers/animation-forensics.ts)

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
| `includeAnimations` | `boolean` | `true` | Extracts active CSS/WAAPI animations, timing, keyframes, and stagger patterns. |

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
When `selector` is provided and `includeCascade !== false`, queries CDP `CSS.getMatchedStylesForNode` to explain:
- Winning CSS rules vs overridden declarations.
- `@layer` priority (including `!important` layer inversion) and inline styles.

### 3.3 Multi-Breakpoint Overflow & Responsive Diff (`breakpointAudits`)
Runs `layoutForensics` at each requested breakpoint (`mobile`, `tablet`, `desktop`) via `manager.withBreakpointMetrics(...)`, reporting `hasHorizontalOverflow`, `overflowCulpritsCount`, and `topCulprit`, then restores the original viewport. When `selector` is also provided, each breakpoint entry includes `targetLayout` (`rect`, `display`, `flexDirection`, `gridTemplateColumns`, `fontSize`, `visibility`) for structured responsive diffing without extra screenshots.

### 3.4 Animation & Motion Forensics (`animations`)
When `includeAnimations !== false` and active animations exist (scoped to `selector` if provided, otherwise document-wide), extracts WAAPI/CSS animations (`type`, `name`, `playState`, `durationMs`, `delayMs`, `iterations`, `easing`, `keyframes`), capped at `15` items, and detects consistent `staggerPatterns` (`stepMs`, `baseDelayMs`, `count`, `selectors`).

### 3.5 Runtime Health (`runtimeHealth`)
- **Session-Wide Scope:** Explicitly labeled `scope: "browser-session"` (logs are collected across attached pages, not isolated to a single URL).
- **Console Logs:** Consecutive identical messages are deduplicated with `(xN)`. Individual messages are capped at `8000` UTF-16 code units (`textTruncated`, `originalTextLength`), and query secrets in error locations are stripped.
- **Failed Network Requests:** Records only `status >= 400` or `requestfailed` in compact `METHOD STATUS pathname` format (max `200` chars pathname; query strings and bodies discarded).
- **Safe Buffer Consumption:** `clearLogs: true` is applied **only after** target validation, selector/cascade analysis, and `enforceResponseBudget` succeed, so a failed diagnosis never drains buffered evidence.
