# Feature SSOT: UI Interactions & Live CSS Sandbox (`spector_interact`, `spector_preview_css`)

Source: [src/tools/interact.ts](../../src/tools/interact.ts), [src/browser/interactions.ts](../../src/browser/interactions.ts), [src/tools/preview.ts](../../src/tools/preview.ts), [src/browser/preview-css.ts](../../src/browser/preview-css.ts)

---

## 1. `spector_interact`

Dispatches targeted UI interactions inside `manager.runBrowserOperation(..., true)` to reveal hidden or transient UI states (dropdowns, modals, tabs, hover cards, offscreen sections) before inspection.

### Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `action` | `"click" \| "hover" \| "scroll" \| "scrollIntoView" \| "fill" \| "pressKey" \| "selectOption"` | *required* | Interaction type to execute. |
| `selector` | `string` | — | Target CSS selector (required for `click`, `hover`, `scrollIntoView`, `fill`, `pressKey`, `selectOption`; optional for `scroll`). |
| `value` | `string` | — | Text for `fill`, key chord for `pressKey` (e.g. `"Enter"`, `"Tab"`), or option value for `selectOption`. |
| `scrollDelta` | `{ x?: number; y?: number }` | `{ x: 0, y: 300 }` | Pixel scroll delta when `action` is `"scroll"`. |
| `waitForTimeoutMs` | `number` | `0` | Additional settle delay (`0–30000 ms`) after interaction for CSS transitions or state updates. |
| `expectedUrl` | `string` | — | Exact URL precondition checked before the action; intentional navigation *after* the action is permitted. |

### Safety & Redaction
- **No Automatic Retries:** Interactions are never retried automatically to avoid duplicate side effects.
- **Log Redaction:** `fill` / input `value` and `expectedUrl` / `url` arguments are redacted from tool invocation and failure logs (while non-secret keyboard key names like `"Enter"` are preserved).

---

## 2. `spector_preview_css`

Manages an ephemeral `<style id="spector-live-preview">` tag in the active page to test visual CSS overrides before editing project source files.

### Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `action` | `"apply" \| "append" \| "get" \| "clear"` | *required* | `"apply"` replaces stylesheet content; `"append"` adds rules; `"get"` reads current preview CSS; `"clear"` removes the `<style>` tag. |
| `css` | `string` | — | CSS text to inject (required for `"apply"` and `"append"`). |

### Operational Note
Always run `spector_preview_css({ action: "clear" })` before final screenshot/diagnostic verification so temporary overrides do not mask actual source-file styling.
