# Feature SSOT: Engine Architecture, Coordination & Budgets

Source: [src/browser/cdp-session.ts](../../src/browser/cdp-session.ts), [src/constants.ts](../../src/constants.ts), [src/utils/result-budget.ts](../../src/utils/result-budget.ts), [src/utils/mcp-response.ts](../../src/utils/mcp-response.ts)

---

## 1. Per-Page Operation Queue & Ownership

`CdpSessionManager` coordinates browser work per page (`runBrowserOperation`) to prevent concurrent CDP emulation/capture races in a shared physical Chrome session:

- **Per-Page Serialization:** Operations on the same page queue sequentially; operations on unrelated pages proceed independently.
- **Nested Collector Reuse:** Nested collectors reuse the active page ownership token rather than deadlocking; async work that outlives its parent cannot reuse released ownership.
- **Bounded Queue & Caller Deadline:**
  - Maximum `16` pending operations per page (`TOKEN_BUDGETS.MAX_PENDING_OPERATIONS`).
  - Caller deadline of `30000 ms` (`TIMEOUTS.OPERATION_DEFAULT_MS`), including queue wait.
  - Expired queued operations never run; a running operation's timeout does not release page ownership until cleanup settles.
- **Picker Exception:** `spector_picker({ action: "pick" })` waits outside the queue so human clicks and `spector_interact` calls can complete selection concurrently.

---

## 2. Browser Activity Indicator

During agent browser operations, Spector displays a non-blocking corner badge (`"Spector sedang menggunakan tab ini"`) on the operated tab:
- Keeps keyboard focus and pointer input available to the human developer.
- Excluded from layout forensics, DOM/token extraction, and Spector screenshots (capture is rejected if activity exclusion fails).
- Shared local counter cleans up on completion, failure, or disconnect; a page-side expiry removes stale badges after `60` seconds without updates.

---

## 3. Target Validation & Metadata

Every read/capture operation records metadata with a session-local `targetId`, sanitized URL (query values, credentials, and fragments redacted), actual render dimensions, and timestamp:
- **Main-Frame Navigation Guard:** Read operations (`spector_get_dom_tree`, `spector_capture_screenshot`, `spector_diagnose`) reject observed main-frame navigation, including a reload to the same URL.
- **Target Closure:** If the selected tab closes, dependent operations return `TARGET_CHANGED`.

---

## 4. Resource Budgets & Limits (`src/constants.ts`)

| Resource | Limit | Error / Handling |
| :--- | :--- | :--- |
| **MCP Response JSON** | `12 MiB` (`12 * 1024 * 1024` UTF-8 bytes) | `RESOURCE_LIMIT_EXCEEDED` (enforced before `clearAfterRead` / `clearLogs` drains state). |
| **Screenshot Size / Pixels** | `6 MiB` PNG / `12,000,000` physical pixels | `RESOURCE_LIMIT_EXCEEDED` |
| **Browser Picker Payload** | `512 KiB` / `10` pins (`MAX_PIN_QUEUE`) | Validated by Zod before collection. |
| **DOM Tree** | `1000` nodes / `64,000` chars / depth `8` | Truncated with explicit coverage header. |
| **Diagnose Issues / Subtree** | `15` issues / `150` subtree elements | Reported with `coverage` limit indicators. |
| **Tokens / CSS Variables** | `300` elements / `50` `:root` variables | Reported with `coverage` limit indicators. |
| **Console / Network Buffer** | `100` logs max / `8000` UTF-16 chars per message | Truncated messages marked with `textTruncated` & `originalTextLength`. |

---

## 5. Fail-Safe Error Contract (`SpectorError`)

All tool handlers use `instrumentHandler` and `failSafeResponse`, returning structured `SpectorError` codes with actionable `recommendation` guidance without leaking raw internal stack/socket details:
- `INVALID_CDP_URL`, `CHROME_CDP_UNAVAILABLE`, `BROWSER_NOT_ATTACHED`, `BROWSER_CONTEXT_UNAVAILABLE`
- `TARGET_CHANGED`, `TAB_NOT_FOUND`, `ELEMENT_NOT_READY`
- `NO_PICKED_ELEMENT`, `PICKER_CANCELLED`
- `OPERATION_TIMEOUT`, `RESOURCE_LIMIT_EXCEEDED`, `VIEWPORT_RESTORE_FAILED`, `INVALID_TOOL_INPUT`
