# Spector Feature Documentation (SSOT)

This directory is the **Single Source of Truth (SSOT)** for Spector's architecture, 5 core MCP tools, and engine invariants.

## Design Principles

1. **Human-to-AI Visual Bridge:** Developer points at an element/region in their live physical Chrome (`Alt + P`) with an optional note; Spector delivers a distilled Design Blueprint + auto-attached CSS/layout forensics.
2. **Before/After Determinism:** After editing source code, the agent calls `spector_picker({ action: "verify" })` to get exact `rectDelta`, `styleChanges`, `forensicsDelta`, and a fresh screenshot.
3. **Token-Lean Evidence:** Never dump raw `outerHTML`. Strip defaults, cap scan budgets, and attach forensics only when anomalies exist.
4. **Shared-Browser Safety:** Coordinates per-page operations with an explicit queue, validates target identity (`TARGET_CHANGED`, `expectedUrl`), and preserves physical Chrome sessions on disconnect.

## Feature Modules (5 Core Tools)

| Document | Tools | Responsibility |
| :--- | :--- | :--- |
| [`session-and-tabs.md`](./session-and-tabs.md) | `spector_attach`, `spector_tabs` | Loopback CDP attach (`http://` & `ws://`), tab discovery & switching (`index`/`url`/`title`/`latest`), and `TARGET_CHANGED` recovery. |
| [`spector-picker.md`](./spector-picker.md) | `spector_picker` | Point → Annotate → Send `Alt+P` overlay, Design Blueprints, auto-forensics, `:hover`/`:focus-visible` deltas, cross-tab A/B `comparison`, and Before/After `verify`. |
| [`spector-diagnose.md`](./spector-diagnose.md) | `spector_diagnose` | Layout anomaly & inactive CSS scanner, CDP CSS cascade explainer, multi-breakpoint overflow + `targetLayout`, and active-tab runtime health. |
| [`spector-inspect.md`](./spector-inspect.md) | `spector_capture_screenshot` | Single and multi-breakpoint PNG screenshots with `colorScheme`/`reducedMotion` emulation and viewport restoration. |
| [`engine-and-budgets.md`](./engine-and-budgets.md) | *(Internal Engine)* | Per-page operation queue, nested collector ownership, coverage accounting, response/screenshot/picker budgets, and fail-safe `SpectorError` codes. |
