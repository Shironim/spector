# Feature SSOT: Global Design DNA Extractor (`spector_extract_tokens`)

Source: [src/tools/design-tokens.ts](../../src/tools/design-tokens.ts), [src/analyzers/token-extractor.ts](../../src/analyzers/token-extractor.ts), [src/analyzers/token-mapper.ts](../../src/analyzers/token-mapper.ts)

---

## 1. Overview

`spector_extract_tokens` scans `:root` CSS custom properties and visible DOM elements on the active tab (typically a reference website) to distill a compact Design DNA summary.

---

## 2. Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `includeVariables` | `boolean` | `true` | Extract `:root` CSS custom properties (`--*`). |
| `maxPaletteItems` | `number` | `8` | Maximum colors returned per palette category. |

---

## 3. Extracted Categories & Limits

- **CSS Custom Properties (`cssVariables`):** Up to `50` (`TOKEN_BUDGETS.MAX_CSS_VARIABLES`) `:root` `--*` variables.
- **Color Palette:** Categorized visible colors (backgrounds, surfaces, texts, accents, borders), each bounded by `maxPaletteItems`.
- **Typography Scale:** Font families, sizes, weights, and line heights observed across visible elements.
- **Shape, Elevation & Layout:** Border radii, box shadows, and container widths.
- **Token & Utility Mapping (`tokenMap`):** When matches exist, maps extracted palette colors, radii, shadows, and container widths to `:root` custom properties (`cssVarMatches`, e.g. `var(--brand-primary)`) and maps radii, font sizes, and container widths to nearest Tailwind utility hints (`tailwindHints`, e.g. `rounded-xl`, `text-2xl`, `max-w-screen-xl`).
- **Coverage Accounting:** Scans up to `300` visible elements (`TOKEN_BUDGETS.MAX_TOKEN_SCAN_ELEMENTS`), excluding Spector's own activity indicator, and reports `coverage` (visited/candidate counts and limit indicators).
