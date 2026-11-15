# Feature SSOT: Session, Tabs & Navigation (`spector_attach`, `spector_tabs`, `spector_navigate`)

Source: [src/tools/session.ts](../../src/tools/session.ts), [src/browser/cdp-session.ts](../../src/browser/cdp-session.ts)

---

## 1. `spector_attach`

Connects Spector to a local Google Chrome instance over Chrome DevTools Protocol (CDP), preserving existing cookies, local storage, CSRF tokens, and local `.test`/Docker dev domains.

### Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cdpUrl` | `string` | `"http://localhost:9222"` | Chrome remote debugging endpoint (`http://`, `https://`, `ws://`, or `wss://`). **Loopback-only** (`localhost`, `127.0.0.1`, or `::1`). |
| `autoSelectActiveTab` | `boolean` | `true` | On first connection, selects the last tab in browser context order (not OS window focus). Reattaching preserves the already-selected target. |
| `autoLaunch` | `boolean` | `true` | Launches a dedicated Chrome dev profile using the port from `cdpUrl` if Chrome is not already running (skipped for `ws://`/`wss://` endpoints). |

### Behavior & Invariants
- **On-Demand Auto-Attach:** Other browser tools call `manager.ensurePage()`, which can attach or auto-launch Chrome automatically. Explicit `spector_attach` is primarily needed for a custom `cdpUrl` or `autoLaunch: false`.
- **Clean Disconnect:** On MCP shutdown (stdin EOF, SIGINT, SIGTERM), Spector removes telemetry listeners and disconnects CDP **without closing your physical Chrome process**.

---

## 2. `spector_tabs`

Unified tab discovery and switching tool (replaces the earlier separate `spector_list_tabs` and `spector_select_tab` tools).

### Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `action` | `"list" \| "select"` | *inferred* | `"list"` returns all open tabs; `"select"` switches the active target. If omitted: defaults to `"select"` when `index`, `url`, `title`, or `latest: true` is provided, otherwise `"list"`. |
| `index` | `number` | — | Target tab index from `spector_tabs({ action: "list" })`. |
| `url` | `string` | — | URL substring or simple wildcard glob (e.g. `"localhost:3000"`, `"*stripe.com*"`). |
| `title` | `string` | — | Page title substring to match. |
| `latest` | `boolean` | — | Selects the newest/last tab in browser context order (useful to sync after an external CDP client opens a tab). |

### Shared-Browser Target Contract
- Opening new tabs or reattaching to the same connected context **does not hijack** the currently selected tab.
- If the selected tab is closed externally, dependent operations fail with `TARGET_CHANGED`. Recover explicitly via `spector_tabs({ action: "list" })` and `spector_tabs({ action: "select", ... })`.
- If no tab matches the filter, returns `TAB_NOT_FOUND`.

---

## 3. `spector_navigate` *(`--profile full` only)*

Navigates the active tab to a URL or reloads the current page inside `manager.runBrowserOperation(..., true)`.

### Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `url` | `string` | *required* | Target URL (e.g. `"http://localhost:3000"`) or `"reload"` to refresh the active page. |
| `waitUntil` | `"load" \| "domcontentloaded" \| "networkidle"` | `"load"` | Playwright navigation completion condition. |

### Behavior
- Timeout follows `TIMEOUTS.NAVIGATION_DEFAULT_MS` (`15000 ms`).
- Returns `{ status: "navigated", url, title }`.
- When navigating away from a Chrome internal page (`chrome://`, `about:blank`, etc.) to a real page, telemetry listeners are ensured on the page.
