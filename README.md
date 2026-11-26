# spector

[![npm version](https://img.shields.io/npm/v/@dimassetoid/spector.svg?style=flat-square)](https://www.npmjs.com/package/@dimassetoid/spector)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg?style=flat-square)](https://modelcontextprotocol.io)

**Spector** is a **Human-to-AI Visual Annotation & CSS Forensics MCP Server** for your live physical Google Chrome session via Chrome DevTools Protocol (CDP). Point at any element or region with `Alt + P`, add an optional note, and hand your AI coding agent a distilled Design Blueprint with auto-attached CSS/layout forensics — then verify Before vs After diffs deterministically after code edits.

---

## Core Capabilities

- **Live Physical Chrome CDP Attach (`spector_attach`, `spector_tabs`):** Connects to local Chrome (`localhost`, `127.0.0.1`, `::1`), preserving cookies, auth sessions, and `.test`/Docker domains without closing your browser on disconnect.
- **Point → Annotate → Send Overlay (`Alt + P` & `spector_picker`):**
  - Click an element or drag a region automatically (no mode toggles).
  - Step up/down the DOM tree with `↑`/`↓` (or `Shift + Scroll`) before locking selection.
  - Floating popover for optional notes, multi-pin queueing (`+ Pin`), and cross-tab Target A vs Reference B comparison.
  - **Auto-Forensics on Pin:** Automatically attaches overridden CSS cascade rules and targeted layout traps (overflow, sticky clipping, stacking context, inactive CSS) when anomalies exist.
  - **Before/After Pin Verification (`action: "verify"`):** Re-captures a pinned selector after code edits/HMR and returns exact `rectDelta`, `styleChanges`, `forensicsDelta`, and a fresh cropped PNG.
- **Layout & CSS Cascade Forensics (`spector_diagnose`):** Pinpoints horizontal overflow culprits, clipping/z-index traps, inactive CSS hints, broken media/fonts, CDP CSS cascade overrides (`@layer` & specificity), multi-breakpoint overflow, and active-tab console/network errors.
- **Multi-Breakpoint Visual Snapshots (`spector_capture_screenshot`):** Captures element, page, or `mobile`/`tablet`/`desktop` PNG screenshots with optional `colorScheme`/`reducedMotion` emulation and automatic viewport restoration.

---

## Quick Start

### 1. Install & Initialize

```bash
npm i -g @dimassetoid/spector
spector init
```

### 2. Configure Your MCP Client

Add Spector to your MCP client configuration (Antigravity, Cursor, Claude Desktop, or OpenCode):

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

Spector communicates over `stdin`/`stdout` (internal logs go to `stderr`). Start Chrome with `--remote-debugging-port=9222` or let `spector_attach` auto-launch a dedicated per-user dev profile (`CHROME_PATH` env var supported on Linux/macOS/Windows). The `Alt + P` overlay is active on all attached tabs.

---

## Tools Reference (6 Core Tools)

| Tool | Purpose |
| :--- | :--- |
| `spector_attach` | Connects to a local Chrome CDP endpoint (auto-launches if enabled). |
| `spector_tabs` | Lists open tabs (`"list"`), switches active tab (`"select"`), reloads (`"reload"`), or navigates local dev / same-origin routes (`"navigate"`). |
| `spector_picker` | Retrieves `Alt+P` Blueprints + auto-forensics (`"get"`), opens overlay (`"pick"`), programmatically snapshots a selector (`"snapshot"`), checks Before vs After diffs (`"verify"`), or clears queue (`"clear"`). |
| `spector_diagnose` | Runs layout traps (`rootSelector`, `maxElements`), WCAG AA contrast & mobile touch-target audit, optional design-token distribution (`includeTokens`), CDP CSS cascade, multi-breakpoint overflow, and active-tab console/network logs (`clearLogs: false` default). |
| `spector_capture_screenshot` | Captures element, page, `mobile`/`tablet`/`desktop` breakpoints, and/or batch `colorSchemes: ["light", "dark"]` PNG screenshots with automatic viewport & media restoration. |
| `spector_interact` | Minimal UI inspection triggers (`click`, `hover`, `scrollTo`) to open dropdowns, tabs, modals, or scroll sections during visual audits. |

---

## Documentation

Detailed tool contracts, engine invariants, and resource budgets are maintained in **[`docs/feature/README.md`](docs/feature/README.md)**.

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
