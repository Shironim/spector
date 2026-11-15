# Spector Features — Single Source of Truth (SSOT)

Welcome to the official **Single Source of Truth (SSOT)** documentation directory for **Spector** (`@dimassetoid/spector` 1.1.0), a **Perceptual Design, Motion & CSS Forensics Compiler** over Model Context Protocol (MCP) for live Google Chrome via Chrome DevTools Protocol (CDP).

This directory is written for both **human engineers** and **AI coding agents** so every tool contract, engine invariant, and resource limit stays aligned with the current source code.

---

## 1. Philosophy & Problems Solved

1. **Eliminates Pixel Guessing:** Extracts exact computed typography, flex/grid layout, surfaces, `:hover`/`:focus-visible` pseudo-state deltas, and Global Design DNA rather than relying on visual guesses from screenshots.
2. **Eliminates State & Session Blindness:** Attaches to your physical Chrome session via CDP (`localhost`/`127.0.0.1`/`::1`), preserving auth cookies, session storage, CSRF tokens, and local `.test`/Docker domains.
3. **Token-Lean Forensics:** Compresses DOM trees, deduplicates subtree summaries and console/network errors, and enforces strict byte/pixel/node budgets.
4. **Shared-Browser Safety:** Coordinates per-page operations with an explicit queue, validates target identity (`TARGET_CHANGED`, `expectedUrl`), and displays a non-blocking activity indicator (`"Spector sedang menggunakan tab ini"`) while operating a tab.

---

## 2. Feature Navigation Map

### Tool Profiles (`--profile forensics` vs `--profile full`)

- `--profile forensics` (**default**): Registers the **7 core forensics tools** (`spector_attach`, `spector_tabs`, `spector_picker`, `spector_capture_screenshot`, `spector_diagnose`, `spector_extract_tokens`, `spector_preview_css`), omitting `spector_navigate`, `spector_get_dom_tree`, and `spector_interact` to keep agent context lean and coexist cleanly with external browser automation clients over shared CDP.
- `--profile full` (or `SPECTOR_PROFILE=full`): Registers all **10 tools** (including `spector_navigate`, `spector_get_dom_tree`, and `spector_interact`) for stand-alone usage.

### Core MCP Tools

| SSOT Document | Covered Tool(s) | Primary Scope & Focus |
| :--- | :--- | :--- |
| [`session-and-tabs.md`](./session-and-tabs.md) | `spector_attach`, `spector_tabs`, `spector_navigate` *(full only)* | Loopback CDP attach (`http://` & `ws://`), tab discovery & switching (`index`/`url`/`title`/`latest`), `TARGET_CHANGED` recovery, and page navigation/reload. |
| [`spector-picker.md`](./spector-picker.md) | `spector_picker` | Unified `Alt+P` & overlay picker (`action: "get" \| "pick" \| "clear"`): Design Blueprints, animations/keyframes, region marquee, Quick Notes, `:hover`/`:focus-visible` deltas, cross-tab A/B `comparison`, and PinStore queue. |
| [`spector-diagnose.md`](./spector-diagnose.md) | `spector_diagnose` | Unified UI forensics: layout anomaly & inactive CSS scanner, CDP CSS cascade explainer, WAAPI/CSS animation & stagger forensics, multi-breakpoint overflow + `targetLayout`, and `browser-session` runtime health. |
| [`spector-inspect.md`](./spector-inspect.md) | `spector_get_dom_tree` *(full only)*, `spector_capture_screenshot` | Token-lean semantic DOM tree (Tailwind classes, `[box=x,y,w,h]`, `[offscreen]`, Shadow DOM, password masking) and single/multi-breakpoint PNG screenshots with viewport restoration. |
| [`spector-design-tokens.md`](./spector-design-tokens.md) | `spector_extract_tokens` | Global Design DNA extractor: `:root` CSS variables, categorized color palette, typography scale, border radii, shadows, container widths, and `tokenMap` (`cssVarMatches` + `tailwindHints`). |
| [`spector-interact-and-preview.md`](./spector-interact-and-preview.md) | `spector_interact` *(full only)*, `spector_preview_css` | UI state dispatcher and ephemeral `<style id="spector-live-preview">` CSS sandbox. |

### Foundational Engine & Contracts

| SSOT Document | Scope |
| :--- | :--- |
| [`engine-and-budgets.md`](./engine-and-budgets.md) | `CdpSessionManager` per-page operation queue, nested collector ownership, browser activity indicator, coverage accounting, response/screenshot/picker budgets, and fail-safe `SpectorError` codes. |

---

## 3. AI Agent Tool Routing Matrix

| Scenario | Recommended Tool Call | Why |
| :--- | :--- | :--- |
| **User points to an element / pressed `Alt+P`** | `spector_picker({ action: "get", includeHoverState: true })` | Returns the pinned Design Blueprint, framework `sourceFile` hint, and cropped screenshot without guessing. |
| **Compare Reference (B) vs Target (A) across tabs** | `spector_tabs` + `spector_picker({ action: "get" })` | Switches between tabs and computes `comparison` (`dimensionDelta`, `styleDiffs`, `hoverDiffs`). |
| **AI initiates element/region selection** | `spector_picker({ action: "pick", role: "target" })` | Opens the unified overlay for interactive click or `selectionMode: "region"` drag. |
| **Debug broken layout, CSS override, or runtime errors** | `spector_diagnose({ selector, breakpoints })` | Combines layout anomaly scan, CDP cascade rules, multi-breakpoint overflow, and console/network logs in one call. |
| **Extract design system from a reference page** | `spector_extract_tokens()` | Distills `:root` variables, palette, typography, radii, shadows, and container widths. |
| **Find selectors or inspect hierarchy autonomously** | `spector_get_dom_tree({ selector, maxDepth: 8 })` | Returns token-lean semantic DOM with Tailwind classes and password masking. |
| **Verify visual layout across viewports** | `spector_capture_screenshot({ breakpoints: ["mobile", "desktop"] })` | Captures PNGs at `mobile`/`tablet`/`desktop` and restores original viewport. |
| **Open dropdown/modal/hover state before inspecting** | `spector_interact({ action: "click", selector })` | Triggers interactive UI states with optional `waitForTimeoutMs` settle delay. |
| **Test temporary CSS fix before editing files** | `spector_preview_css({ action: "apply", css })` | Injects ephemeral `<style id="spector-live-preview">` (clear afterward). |
