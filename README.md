# spector
 
[![npm version](https://img.shields.io/npm/v/@dimassetoid/spector.svg?style=flat-square)](https://www.npmjs.com/package/@dimassetoid/spector)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg?style=flat-square)](https://modelcontextprotocol.io)

Model Context Protocol (MCP) server that connects AI coding assistants directly to your physical Google Chrome session via Chrome DevTools Protocol (CDP). Designed as a selective perceptual transducer that eliminates context rot and token bloat through token-lean DOM trees, in-browser visual inspection (`Alt + P`), semantic DOM diffing, and noise-filtered telemetry.

---

## Core Capabilities

- **Session Preservation (CDP Attach):** Reuses your physical Chrome session. Authenticated cookies, local storage, CSRF tokens, and local dev domains (`localhost`, Docker, Laravel Herd `.test`) work out-of-the-box.
- **In-Browser Inspector (`Alt + P`):** Hit `Alt + P` on any tab, click any element, and AI instantly receives exact CSS selectors, React/Vue component names, computed tokens, and cropped screenshots.
- **Framework Component Tracing:** Automatically maps visual UI elements directly to React Fiber (`displayName`, `_debugSource`) and Vue SFC (`__vueParentComponent`) source files.
- **Semantic DOM Diffing (`spector_diff_dom`):** Compares live DOM with pre-action baseline to verify UI changes with minimal tokens instead of dumping entire DOM trees.
- **Anti-Context Rot Telemetry:**
  - **Network:** Auto-drops static assets (`image`, `font`, `css`), redacts sensitive credentials, and returns compact 1-line dynamic request summaries.
  - **Console:** Automatic run-length deduplication (`(xN)`) and default `error` severity filtering.
- **Token-Lean DOM:** Generates compressed accessibility trees with bounding boxes `[box=x,y,w,h]`, reducing context tokens by up to 95% compared to raw HTML.
- **Resilient Multi-Tab Routing:** Auto-detects newly opened tabs, supports regex URL pattern matching, and gracefully handles tab closures.

---

## Quick Start

### 1. Install Globally
```bash
npm i -g @dimassetoid/spector
```

### 2. Configure MCP Client
Tambahkan Spector ke konfigurasi MCP client (`claude_desktop_config.json`, `.cursor/mcp.json`, Antigravity, atau OpenCode):

```json
{
  "mcpServers": {
    "spector": {
      "command": "npx",
      "args": ["-y", "@dimassetoid/spector"]
    }
  }
}
```

## The `Alt + P` Workflow

1. **Trigger:** Press `Alt + P` inside any open tab.
2. **Select:** Click any component to highlight and capture it.
3. **Inspect:** AI calls `spector_get_last_picked` to receive targeted selector, framework component origin, computed design tokens, screenshot, and scoped subtree.

---

## Tools Reference

| Primary Tool | Alias | Key Parameters | Action / Output |
| :--- | :--- | :--- | :--- |
| `spector_get_last_picked` | `browser_get_last_picked` | `clearAfterRead?` | Retrieves element captured via `Alt + P` (selector, component, styles, screenshot). |
| `spector_pick_element` | `browser_pick_element` | `timeoutMs?`, `includeScreenshot?`, `includeStyles?` | Proactively triggers in-browser inspector banner and awaits click. |
| `spector_diff_dom` | `browser_diff_dom` | `selector?`, `resetBaseline?` | Verifies post-action UI changes by returning delta mutations against baseline. |
| `spector_get_dom_tree` | `browser_get_dom_tree` | `selector?`, `includeBoundingBox?`, `includeOffscreen?` | Returns compressed accessibility tree with bounding boxes. |
| `spector_get_network_logs` | `browser_get_network_logs` | `filter?`, `statusFilter?`, `format?`, `limit?`, `includeStaticAssets?` | Returns telemetry of dynamic requests (compact 1-line by default; assets dropped). |
| `spector_get_console_logs` | `browser_get_console_logs` | `level?`, `format?`, `limit?`, `clearAfterRead?` | Returns console errors and exceptions with run-length deduplication. |
| `spector_list_tabs` | `browser_list_tabs` | — | Lists open tabs with indices, titles, URLs, and active status. |
| `spector_select_tab` | `browser_select_tab` | `index?`, `url?`, `urlPattern?`, `title?`, `debugSessionId?` | Switches active tab via index, URL, regex, or session ID. |
| `spector_interact` | `browser_interact` | `action`, `selector?`, `text?`, `key?`, `scrollDelta?` | Dispatches `click`, `fill`, `type`, `hover`, `scroll`, or `press_key`. |
| `spector_navigate` | `browser_navigate` | `url`, `waitUntil?` | Navigates active tab or reloads current page. |
| `spector_capture_screenshot` | `browser_capture_screenshot` | `fullPage?`, `selector?` | Captures viewport or element screenshot (PNG Base64). |
| `spector_attach` | `browser_attach` | `cdpUrl?`, `autoLaunch?` | Attaches to physical Chrome CDP instance on port 9222. |

---

## Development

```bash
bun install && bun run build
node dist/index.js
```

---

## License

MIT © [Dimas Seto](https://github.com/dimasseto)
