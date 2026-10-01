# spector
 
[![npm version](https://img.shields.io/npm/v/@dimassetoid/spector.svg?style=flat-square)](https://www.npmjs.com/package/@dimassetoid/spector)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg?style=flat-square)](https://modelcontextprotocol.io)

Model Context Protocol (MCP) server that connects AI coding assistants directly to your physical Google Chrome session via Chrome DevTools Protocol (CDP). Designed as a selective perceptual transducer that eliminates context rot and token bloat through token-lean DOM trees, in-browser visual inspection (`Alt + P`), automated **Pick-to-Source** code navigation, semantic DOM diffing, and noise-filtered telemetry.

---

## Core Capabilities

- **Session Preservation (CDP Attach):** Reuses your physical Chrome session (`http://localhost:9222`). Authenticated cookies, session storage, CSRF tokens, and local dev domains (`localhost`, Docker, Laravel Herd `.test`) work out-of-the-box. Never prompts for re-login.
- **Pick-to-Source Physical Grounding:** Hit `Alt + P` on any tab or call `spector_pick_element`. Spector traces the framework component (Vue, React Fiber, Svelte, Angular, Inertia, Blade, Alpine, Livewire), un-mangles Vite/Webpack dev-server URLs, and resolves the exact physical file on disk (`file:///path/to/Component.vue#L24`) complete with a 5-line code snippet preview with pointer (`>`).
- **Semantic DOM Diffing (`spector_diff_dom`):** Compares live DOM against a recorded baseline to verify post-mutation UI changes with minimal tokens, preventing massive whole-DOM context dumps.
- **Token-Lean DOM (`spector_get_dom_tree`):** Generates compressed accessibility trees with bounding boxes `[box=x,y,w,h]` and component tags `[comp=CheckoutButton]`, reducing context tokens by up to 95% compared to raw HTML.
- **Anti-Context Rot Telemetry & Security:**
  - **Network:** Auto-drops static assets (`image`, `font`, `css`), redacts sensitive credentials and authorization tokens, and returns compact 1-line dynamic request summaries (`format: "compact"`).
  - **Console:** Automatic run-length deduplication (`(xN)`) and default `error` severity filtering.
  - **Stdio Integrity:** All server diagnostics and timing logs write strictly to `stderr`, completely eliminating JSON-RPC communication corruption on `stdout`.
- **Advanced Interaction & Multi-Tab Routing:** Dispatches `scrollIntoView`, `click`, `fill`, `hover`, and keyboard input with post-settling delays (`waitForTimeoutMs`). Select tabs via regex patterns (`urlPattern`), page title, or multi-tool correlation session IDs (`debugSessionId`).

---

## Quick Start

### 1. Install or Run via npx
```bash
# Run directly via npx (recommended)
npx -y @dimassetoid/spector

# Or install globally
npm i -g @dimassetoid/spector
```

### 2. Initialize Project Skill (Optional but Recommended)
Run `spector init` inside your project root to automatically generate the agent skill file (`.agents/skills/spector-inspect/SKILL.md` or `.cursor/skills/`):

```bash
npx @dimassetoid/spector init
```

### 3. Configure MCP Client
Add Spector to your MCP client configuration (`claude_desktop_config.json`, `.cursor/mcp.json`, Antigravity, or OpenCode):

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

> **Tip:** Start Google Chrome with remote debugging enabled:
> ```bash
> chrome --remote-debugging-port=9222
> ```
> *If Chrome is not running when an MCP tool is called, Spector will automatically launch Chrome with remote debugging enabled for you.*

---

## The `Alt + P` (Pick-to-Source) Workflow

1. **Trigger:** Press `Alt + P` inside any active browser tab.
2. **Select:** Click any component to highlight and capture it.
3. **Inspect & Ground:** AI calls `spector_get_last_picked` to receive:
   - Precise CSS selector (e.g. `#checkout > div > form > button`)
   - Framework component name & verified physical disk URI (`file:///.../Button.vue#L10`)
   - 5-line source code snippet around the component declaration
   - Bounding rect (`x`, `y`, `width`, `height`)
   - Computed styles (layout, typography, margins, padding, colors)
   - High-resolution cropped screenshot (Base64 PNG)
   - Scoped semantic DOM sub-tree

---

## Tools Reference

| Primary Tool | Alias | Key Parameters | Action / Output |
| :--- | :--- | :--- | :--- |
| `spector_get_last_picked` | `browser_get_last_picked` | `clearAfterRead?` | Retrieves element captured via `Alt + P` (selector, component, physical source path, styles, screenshot). |
| `spector_pick_element` | `browser_pick_element` | `timeoutMs?`, `includeScreenshot?`, `includeStyles?` | Proactively triggers in-browser inspector banner, awaits click, and resolves component source. |
| `spector_diff_dom` | `browser_diff_dom` | `selector?`, `resetBaseline?` | Verifies post-action UI changes by returning delta mutations against baseline. |
| `spector_get_dom_tree` | `browser_get_dom_tree` | `selector?`, `includeBoundingBox?`, `includeOffscreen?` | Returns token-lean compressed accessibility tree with bounding boxes. |
| `spector_get_network_logs` | `browser_get_network_logs` | `filter?`, `statusFilter?`, `format?`, `limit?`, `includeStaticAssets?` | Returns telemetry of dynamic requests (compact 1-line by default; static assets dropped; credentials scrubbed). |
| `spector_get_console_logs` | `browser_get_console_logs` | `level?`, `format?`, `limit?`, `clearAfterRead?` | Returns console errors and exceptions with run-length deduplication. |
| `spector_list_tabs` | `browser_list_tabs` | — | Lists open tabs with indices, titles, URLs, and active status. |
| `spector_select_tab` | `browser_select_tab` | `index?`, `url?`, `urlPattern?`, `title?`, `debugSessionId?` | Switches active tab via index, URL substring, regex pattern, or session ID. |
| `spector_interact` | `browser_interact` | `action`, `selector?`, `text?`, `key?`, `scrollDelta?`, `scrollX?`, `scrollY?`, `waitForTimeoutMs?` | Dispatches `click`, `fill`, `type`, `hover`, `scroll`, `scrollIntoView`, or `press_key`. |
| `spector_navigate` | `browser_navigate` | `url`, `waitUntil?` | Navigates active tab or reloads current page. |
| `spector_capture_screenshot` | `browser_capture_screenshot` | `fullPage?`, `selector?` | Captures viewport or element screenshot (PNG Base64). |
| `spector_attach` | `browser_attach` | `cdpUrl?`, `autoLaunch?` | Attaches to physical Chrome CDP instance on port 9222. |

---

## Development & Build

```bash
# Install dependencies
bun install

# Build distribution bundle
bun run build

# Type check
npm run build:tsc -- --noEmit
```

---

## License

MIT © [Dimas Seto](https://github.com/dimasseto)

