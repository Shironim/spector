# spector

[![npm version](https://img.shields.io/npm/v/@dimassetoid/spector.svg?style=flat-square)](https://www.npmjs.com/package/@dimassetoid/spector)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg?style=flat-square)](https://modelcontextprotocol.io)

**Spector 1.1.0** is a **Perceptual Design, Motion & CSS Forensics Compiler** over the Model Context Protocol (MCP). It connects AI coding agents directly to your physical Google Chrome session via Chrome DevTools Protocol (CDP), replacing pixel-guessing and DOM dumping with Design Blueprints, `:hover`/`:focus-visible` pseudo-state deltas, WAAPI/CSS animation forensics, cross-tab A/B comparisons, Design DNA + token/Tailwind mapping, and unified layout/cascade/inactive-CSS forensics.

---

## Core Capabilities

- **Session-Preserving CDP Attach:** Connects to local Chrome (`localhost`, `127.0.0.1`, `::1`), preserving cookies, auth sessions, CSRF tokens, and `.test`/Docker domains without closing your browser on disconnect.
- **Unified Design Blueprint Picker (`Alt + P` & `spector_picker`):** Captures typography, layout, surface styles, subtree summaries, `<svg>`/`<img>` metadata, framework component hints, `:hover`/`:focus-visible` CDP deltas, and cross-tab Target A vs Reference B diffs.
- **Unified UI Forensics (`spector_diagnose`):** Pinpoints horizontal overflow culprits, clipping/z-index traps, broken media/fonts, CDP CSS cascade overrides (`@layer` & specificity), and deduplicated console/network errors.
- **Global Design DNA (`spector_extract_tokens`):** Distills `:root` CSS variables, color palettes, typography scales, radii, shadows, and container widths from any reference page.
- **Token-Lean DOM & Multi-Breakpoint Audits:** Extracts compressed semantic DOM trees (`spector_get_dom_tree`) with password masking, captures `mobile`/`tablet`/`desktop` screenshots (`spector_capture_screenshot`), dispatches UI interactions (`spector_interact`), and previews ephemeral CSS (`spector_preview_css`).

---

## Quick Start

### 1. Install & Initialize

Install globally via npm (or download a prebuilt binary from [GitHub Releases](https://github.com/Shironim/spector/releases)):

```bash
npm i -g @dimassetoid/spector
spector init
```

### 2. Configure Your MCP Client

Add Spector to your MCP client configuration (`claude_desktop_config.json`, `.cursor/mcp.json`, Antigravity, or OpenCode):

```json
{
  "mcpServers": {
    "spector": {
      "command": "spector",
      "args": ["serve"]
    }
  }
}
```

By default, `spector serve` runs in **`forensics` profile** (exposing the 7 core UI/CSS/motion forensics tools to keep agent context lean when paired with browser automation tools like **`agent-browser`**). If you want Spector stand-alone with all 10 tools (`spector_navigate`, `spector_get_dom_tree`, `spector_interact`), pass `--profile full` (or `SPECTOR_PROFILE=full`):

```json
{
  "mcpServers": {
    "spector": {
      "command": "spector",
      "args": ["serve", "--profile", "full"]
    }
  }
}
```

To share the same Chrome instance between `agent-browser` and Spector, either connect `agent-browser` via `--cdp 9222` / `--auto-connect`, or pass the `ws://127.0.0.1:...` URL from `agent-browser get cdp-url` to `spector_attach`. Use `spector_tabs({ latest: true })` to sync to a newly opened tab.

Spector communicates over `stdin`/`stdout` (internal logs go to `stderr`). When Chrome is not already running with `--remote-debugging-port=9222`, browser tools can attach or auto-launch a dedicated dev profile on demand.

---

## Tools Reference (10 Tools)

| Tool | Purpose |
| :--- | :--- |
| `spector_attach` | Connects to local Chrome CDP endpoint (auto-launches if enabled). |
| `spector_tabs` | Lists open tabs (`action: "list"`) or switches active tab (`action: "select"`). |
| `spector_navigate` | Navigates the active tab to a URL or reloads (`"reload"`). |
| `spector_picker` | Retrieves `Alt+P` Blueprints/A-B diffs (`"get"`), opens overlay (`"pick"`), or clears queue (`"clear"`). |
| `spector_get_dom_tree` | Returns a token-lean semantic DOM tree with Tailwind classes and password masking. |
| `spector_capture_screenshot` | Captures element, page, or `mobile`/`tablet`/`desktop` PNG screenshots and restores viewport. |
| `spector_diagnose` | Runs layout forensics, CDP CSS cascade explanation, breakpoint overflow audit, and runtime logs. |
| `spector_extract_tokens` | Extracts `:root` CSS variables, palette, typography scale, radii, shadows, and container widths. |
| `spector_interact` | Dispatches `click`, `hover`, `scroll`, `scrollIntoView`, `fill`, `pressKey`, and `selectOption`. |
| `spector_preview_css` | Injects, appends, reads, or clears ephemeral `<style id="spector-live-preview">` overrides. |

---

## Documentation

Detailed tool contracts, engine invariants, concurrency/queue semantics, activity indicator behavior, and resource budgets are maintained in **[`docs/feature/README.md`](docs/feature/README.md)**.

---

## Development

```bash
bun install
bun test tests/unit
bunx --no-install tsc --noEmit
bun run build
bun run test:regressions   # Requires local Chrome (or SPECTOR_TEST_CHROME)
```

---

## License

MIT © [Shironim/spector](https://github.com/Shironim/spector)
