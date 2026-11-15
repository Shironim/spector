# Feature SSOT: Design Blueprint Picker & A/B Compare (`spector_picker`)

Source: [src/tools/picker.ts](../../src/tools/picker.ts), [src/browser/overlay-script.ts](../../src/browser/overlay-script.ts), [src/browser/picker-payload.ts](../../src/browser/picker-payload.ts)

---

## 1. Overview

`spector_picker` unifies developer-initiated pinning (`Alt + P` hotkey) and AI-initiated overlay picking into a single tool (`action: "get" | "pick" | "clear"`). It replaces the earlier separate `spector_get_last_picked` and `spector_pick_element` tools.

---

## 2. Parameters

| Parameter | Type | Default | Applies To | Description |
| :--- | :--- | :--- | :--- | :--- |
| `action` | `"get" \| "pick" \| "clear"` | `"get"` | All | `"get"` reads cached pins; `"pick"` opens interactive overlay; `"clear"` empties the pin queue. |
| `includeScreenshot` | `boolean` | `true` | `get`, `pick` | Include cropped PNG screenshot(s). Set `false` for smaller responses without losing metadata. |
| `clearAfterRead` | `boolean` | `false` | `get` | Consumes returned pins from `PinStore` only after response budget validation succeeds. |
| `includeHoverState` | `boolean` | `false` | `get`, `pick` | Forces `:hover` via CDP `CSS.forcePseudoState` to capture hover deltas & transitions. |
| `includeFocusState` | `boolean` | `false` | `get` | Enriches active-tab pin with `:focus-visible` pseudo-state delta via CDP. |
| `timeoutMs` | `number` | `30000` | `pick` | Wait timeout (`TIMEOUTS.PICKER_HOTKEY_DEFAULT_MS`) for developer click/drag. |
| `includeStyles` | `boolean` | `true` | `pick` | Extracts full typography, layout, surface styles, subtree summary, and SVG/img metadata. |
| `role` | `"single" \| "target" \| "reference" \| "pin"` | `"single"` | `pick` | Pin slot role: immediate (`single`), project A (`target`), reference B (`reference`), or multi-pin queue (`pin`). |
| `selectionMode` | `"element" \| "region"` | `"element"` | `pick` | Initial overlay mode: element click or region marquee drag. |

---

## 3. Capabilities & Output Contract

### Design Blueprint Payload
Each picked pin includes:
- **Identity & Context:** `selector`, `boundingRect`, optional 1-line `note`, `documentId`, `elementId`, and `sections` (`dom`, `screenshot`) status.
- **Computed Styles (`includeStyles: true`):** Non-default typography (`fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `textAlign`), layout (`flexWrap`, `justifyContent`, `alignItems`, `gridTemplateRows`, `maxWidth`), surfaces (`backgroundImage`, `backdropFilter`), deduplicated `subtreeSummary` (capped at `150` elements), and `<svg>` (inline markup `<= 2048` bytes) / `<img>` natural-vs-rendered metadata.
- **Animations (`includeStyles: true`, when active):** Active WAAPI/CSS animations & transitions on the element or subtree (`type`, `name`, `playState`, `durationMs`, `delayMs`, `iterations`, `easing`, `direction`, `fill`, and up to `8` keyframes), capped at `8` animations.
- **Framework Hints (No Disk Probing):** Best-effort `componentName`, dev-server-normalized `sourceFile`, and `sourceLine` for React, Vue, Svelte, Livewire, Inertia, Alpine, and Blade. Parent-chain traversal rejects cycles and stops after `1000` entries.

### Cross-Tab A/B Comparison (`target` vs `reference`)
When both **Reference (B)** (e.g. on a reference website tab) and **Target (A)** (on the local project tab) are pinned, `spector_picker({ action: "get" })` returns both pins plus a computed `comparison` diff (`dimensionDelta`, `styleDiffs`, `hoverDiffs`).

### Live Enrichment & Staleness
- Requested `:hover` / `:focus-visible` enrichment reports `captured`, `failed`, `stale`, or `unavailable` without mutating the stored snapshot.
- If the underlying document or DOM element was replaced since the pin was captured, enrichment reports `stale` and omits stale hover/focus data.

---

## 4. Queue, Validation & Failure Modes

- **Payload Limits:** Browser picker payloads are validated with Zod before collection. Batches are capped at `10` pins (`TOKEN_BUDGETS.MAX_PIN_QUEUE`) and `512 KiB` (`TOKEN_BUDGETS.MAX_BROWSER_PAYLOAD_BYTES`).
- **Response Budget Recovery:** If cached screenshots push the response over `12 MiB` (`RESOURCE_LIMIT_EXCEEDED`), `clearAfterRead: true` **does not** delete the pins—retry with `includeScreenshot: false`.
- **Overlay Cancellation / Timeout:** Pressing `Escape` returns `PICKER_CANCELLED`; exceeding `timeoutMs` returns `OPERATION_TIMEOUT`.
- **Queue Behavior:** Picker waiting (`action: "pick"`) runs outside the per-page operation queue so human and MCP interactions can complete selection.
