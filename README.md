# spector
 
[![npm version](https://img.shields.io/npm/v/@dimassetoid/spector.svg?style=flat-square)](https://www.npmjs.com/package/@dimassetoid/spector)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg?style=flat-square)](https://modelcontextprotocol.io)

Model Context Protocol (MCP) server that connects AI coding assistants (Claude Code, Antigravity, OpenCode, Cursor) directly to your active Google Chrome session via Chrome DevTools Protocol (CDP). Features token-lean DOM trees, automatic tab routing, in-browser visual element inspector (`Alt + P`), React/Vue framework component tracing, and semantic DOM diffing.

---

## Core Capabilities

- **Session Preservation (CDP Attach):** Reuses your physical Chrome session. Active cookies, local storage, CSRF tokens, and internal dev domains (`localhost:3000`, Docker, Laravel Herd `.test`, self-signed HTTPS) work out-of-the-box.
- **In-Browser Inspector (`Alt + P`):** Hit `Alt + P` on any tab, click any component, and AI instantly receives exact CSS selectors, React/Vue framework component names, computed design tokens, cropped screenshots, and scoped DOM trees.
- **Framework Component Tracing:** Automatically extracts React Fiber component names (`displayName`, `_debugSource`) and Vue SFC names/files (`__vueParentComponent`), mapping visual UI elements directly to source code files.
- **Semantic DOM Diffing (`spector_diff_dom`):** Compares live DOM against baseline to instantly verify fixes after HMR/reload with up to 90% token savings.
- **Token-Lean DOM:** Generates compressed semantic accessibility trees with bounding boxes `[box=x,y,w,h]` and stable locator recommendations, reducing context token consumption by up to 95% compared to raw HTML dumps.
- **Resilient Multi-Tab Routing:** Auto-detects newly opened tabs, supports regex URL patterns (`urlPattern`) and multi-tool session correlation (`debugSessionId`), and gracefully handles tab closures without breaking CDP connections.
- **Network & Console Telemetry:** Captures 4xx/5xx HTTP errors, XHR/Fetch payloads, console warnings, and uncaught runtime exceptions in memory buffers.

---

## Quick Start & Setup

### 1. Initialize Spector Skill in Your Project
Run this command in any workspace root to automatically inject `.agents/skills/spector-inspect/SKILL.md` (compatible with Antigravity, OpenCode, Claude Code, and Cursor):

```bash
npx -y @dimassetoid/spector init
```

### 2. Configure MCP Client
Add Spector to your MCP client configuration (`claude_desktop_config.json`, `.cursor/mcp.json`, or Antigravity/OpenCode config):

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

> **Zero Configuration (Auto-Launch):** You do NOT need to launch Chrome manually or run any scripts. `spector` automatically detects your system's Google Chrome executable and launches it with port `9222` in the background upon first connection.

---

## The `Alt + P` Workflow

1. **Trigger:** Press `Alt + P` inside any open tab.
2. **Click:** Hover over the target component and click. A toast confirms capture; event default behavior is prevented.
3. **AI Consumption:** AI calls `spector_get_last_picked` to retrieve:
   - Unique CSS selector (e.g. `main > form > div:nth-of-type(1) > label`)
   - Bounding rect (`x`, `y`, `width`, `height`)
   - Computed design tokens (colors, font, padding, margin, border-radius, shadows, flex/grid)
   - High-resolution cropped screenshot (Base64 PNG)
   - Scoped semantic accessibility subtree

---

## Tools Reference

| Primary Tool | Alias | Arguments | Output / Action |
| :--- | :--- | :--- | :--- |
| `spector_get_last_picked` | `browser_get_last_picked` | `clearAfterRead?` | Fetches selector, framework component (`componentName`, `sourceFile`), styles, DOM tree, and screenshot from `Alt + P`. |
| `spector_pick_element` | `browser_pick_element` | `timeoutMs?`, `includeScreenshot?`, `includeStyles?` | Proactive mode: triggers in-browser inspector banner with live component badge and awaits click. |
| `spector_diff_dom` | `browser_diff_dom` | `selector?`, `resetBaseline?` | Semantic DOM diffing: compares live DOM with baseline, reporting added/removed/mutated nodes and text changes. |
| `spector_get_dom_tree` | `browser_get_dom_tree` | `maxDepth?`, `selector?`, `includeBoundingBox?` | Returns compressed accessibility tree with bounding box coordinates `[box=x,y,w,h]`. |
| `spector_get_network_logs` | `browser_get_network_logs` | `filter?`, `statusFilter?`, `clearAfterRead?` | Returns captured requests, response summaries, and status codes. |
| `spector_get_console_logs` | `browser_get_console_logs` | `level?`, `clearAfterRead?` | Returns runtime errors, warnings, and uncaught exceptions. |
| `spector_list_tabs` | `browser_list_tabs` | — | Lists open tabs with indices, titles, URLs, and active status. |
| `spector_select_tab` | `browser_select_tab` | `index?`, `url?`, `urlPattern?`, `title?`, `debugSessionId?` | Switches active page pointer via index, substring, regex URL pattern, or session ID. |
| `spector_capture_screenshot` | `browser_capture_screenshot` | `fullPage?`, `selector?` | Captures viewport or element screenshot (Base64 PNG). |
| `spector_interact` | `browser_interact` | `action`, `selector?`, `text?`, `key?` | Dispatches `click`, `fill`, `type`, `hover`, `scroll`, or `press_key`. |
| `spector_navigate` | `browser_navigate` | `url`, `waitUntil?` | Navigates active tab to a URL or triggers page reload (`"reload"`). |
| `spector_attach` | `browser_attach` | `cdpUrl?`, `autoLaunch?` | Attaches to Chrome CDP instance on port 9222 with endpoint validation. |

---

## Development & Release

```bash
# Build
bun install && bun run build

# Run locally
node dist/index.js

# Publish to npm
npm login && npm publish --access public
```

---

## License

MIT © [Dimas Seto](https://github.com/dimasseto)
