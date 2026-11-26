# spector

[![npm version](https://img.shields.io/npm/v/@dimassetoid/spector.svg?style=flat-square)](https://www.npmjs.com/package/@dimassetoid/spector)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg?style=flat-square)](https://modelcontextprotocol.io)

**Spector** is a visual annotation and CSS forensics MCP server for your live Google Chrome session over Chrome DevTools Protocol (CDP). Point at any element or region with `Alt + P`, add an optional note, and give your AI coding agent a Design Blueprint with computed CSS and layout forensics — then verify Before vs After diffs after edits. Works across Vue, Nuxt, React, Next.js, Svelte, and plain HTML.

---

## Core Capabilities

- **Session-Preserving Chrome Attach (`spector_attach`, `spector_tabs`):** Connects to local Chrome (`localhost`, `127.0.0.1`, `::1`), keeping cookies, auth sessions, and `.test`/Docker domains intact without closing your browser on disconnect. Navigates local dev or same-origin routes with automatic per-tab log clearing (`clearLogsOnNavigate: true`).
- **Point → Annotate → Send Overlay (`Alt + P` & `spector_picker`):**
  - Click an element or drag a region automatically (no mode toggles).
  - Step up or down the DOM tree with `↑`/`↓` (or `Shift + Scroll`) before locking selection.
  - Add notes in the floating popover, queue multiple pins (`+ Pin`), or compare Target A vs Reference B across tabs.
  - **Auto-Forensics on Pin:** Attaches overridden CSS cascade rules and targeted layout traps (overflow, sticky clipping, stacking context, inactive CSS) whenever anomalies exist.
  - **Before/After Pin Verification (`action: "verify"`):** Re-captures a pinned selector after code edits or HMR and returns `rectDelta`, `styleChanges`, `forensicsDelta`, and a cropped PNG.
- **Compact UI & CSS Forensics (`spector_diagnose`):**
  - **Grouped compact output (`detail: "compact"` default):** Collapses repetitive findings by selector pattern (e.g. table rows) to keep context lean; pass `detail: "full"` for raw ungrouped arrays.
  - **Layout & clipping traps:** Detects document horizontal overflow, scrollable table overflow (`internalHorizontalScroll`), viewport/container-clipped interactive elements (`clippedInViewport`), sticky/z-index traps, inactive CSS, and broken images/fonts, with smart table-row sampling when pages exceed `maxElements`.
  - **WCAG AA & mobile touch targets:** Audits computed color contrast, missing accessible names, heading hierarchy, and mobile `<44px` touch targets (including top-10 selectors in `breakpointAudits` or via `viewport: "mobile"`).
  - **DOM → Source File Mapping (`sourceFile`):** Resolves dev-mode component paths for Vue 3/Nuxt (`__vueParentComponent`), React 17/18 (`_debugSource`), and React 19 (`_debugStack`).
  - **Before vs After Session Diff (`delta`) & Clean Logs:** Tracks lightweight per-URL baselines to report metric deltas across runs, and isolates console/network errors by `current-document`, `active-tab`, or `browser-session`.
- **Multi-Breakpoint & Multi-Theme Snapshots (`spector_capture_screenshot`):** Captures element, page, `mobile`/`tablet`/`desktop` breakpoints, and batch `colorSchemes: ["light", "dark"]` PNGs with optional `reducedMotion`, `hideDevtoolsOverlays` (Nuxt, Vue, Next.js, Vite, TanStack), and `hideSelectors`, restoring the original viewport and styles afterward.

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
| `spector_tabs` | Lists open tabs (`"list"`), switches active tab (`"select"`), reloads (`"reload"`), or navigates local dev / same-origin routes (`"navigate"`, `clearLogsOnNavigate: true`). |
| `spector_picker` | Retrieves `Alt+P` Blueprints + auto-forensics (`"get"`), opens the overlay (`"pick"`), snapshots a selector (`"snapshot"`), verifies Before vs After diffs (`"verify"`), or clears the queue (`"clear"`). |
| `spector_diagnose` | Runs grouped (`detail: "compact"`) layout/scroll/clipping forensics, WCAG AA contrast & mobile touch targets (`viewport`), DOM→`sourceFile` mapping, optional design tokens (`includeTokens`), CDP CSS cascade, session `delta`, and scoped console/network logs (`runtimeScope`). |
| `spector_capture_screenshot` | Captures element, page, `mobile`/`tablet`/`desktop` breakpoints, and batch `colorSchemes: ["light", "dark"]` PNGs with optional `hideDevtoolsOverlays` / `hideSelectors` and automatic viewport & media restoration. |
| `spector_interact` | Triggers lightweight UI states (`click`, `hover`, `scrollTo`) to open dropdowns, tabs, modals, or scroll sections during visual audits. |

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
