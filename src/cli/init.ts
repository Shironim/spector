import fs from 'node:fs';
import path from 'node:path';
import { SPECTOR_VERSION } from '../constants.js';

export const SPECTOR_SKILL_CONTENT = `---
name: spector-inspect
description: Live browser sharing, physical Chrome CDP attachment, Design Blueprint extraction (full typography, subtree summary, :hover deltas), multi-pin A/B comparison, Global Design DNA token extraction, layout/cascade forensics, multi-breakpoint screenshots, and temporary CSS preview using Spector.
---

# Skill: Spector Browser Inspector (\`spector-inspect\`)

> Use this skill when working with the developer's live Google Chrome session via **Spector** — a Perceptual Design & UI Forensics Compiler that bridges visual intent, live browser rendering, and your workspace code tools.

---

## 1. Core Operating Principles

1. **Physical Browser Reality & Companion Interop (CDP First):**
   - Spector attaches directly to Chrome via CDP (\`http://localhost:9222\` or \`ws://127.0.0.1:...\` from \`agent-browser get cdp-url\`).
   - Authentication cookies, session storage, CSRF tokens, and local domains (\`localhost:port\`, \`.test\`, Docker) are preserved.
   - When paired with \`agent-browser\`, delegate navigation, clicking, form filling, scrolling, and video recording (\`agent-browser record\`) to \`agent-browser\` (\`--cdp 9222\` / \`--auto-connect\`), then sync the active tab in Spector with \`spector_tabs({ latest: true })\` or \`spector_tabs({ url: "..." })\`.
2. **Spector Observes Browser, You Own the Codebase:**
   - Spector reports framework component hints (\`componentName\`, normalized \`sourceFile\`, \`sourceLine\`) without probing local disk.
   - Use workspace code tools (\`strata-mcp\`, \`septum\`, \`read_file\`, \`rg\`) to open and edit the exact project files.
3. **Token-Lean, Distilled Evidence:**
   - Never dump raw \`outerHTML\`. Use \`spector_picker\`, \`spector_extract_tokens\`, and \`spector_diagnose\` for non-default, deduplicated design & diagnostic telemetry. (Run Spector with \`--profile forensics\` when paired with \`agent-browser\` to keep only the 7 core forensics tools.)
4. **Point-and-Prompt Fast Path:**
   - Whenever the user refers to *"the element I clicked"*, *"compare this with that"*, or pinned items via \`Alt + P\`, **always call \`spector_picker\` first**.

---

## 2. Workflows & Decision Matrix

### Workflow A: Point-and-Prompt & Design Blueprint Inspection
1. Developer presses \`Alt + P\` in Chrome (single click, Region drag, Queue multi-pin, or optional 1-line Quick Note).
2. AI calls:
   \`\`\`typescript
   spector_picker({ action: "get", clearAfterRead: false, includeHoverState: true })
   \`\`\`
3. AI receives the **Design Blueprint**:
   - CSS selector, bounding rect, and quick note (if provided)
   - Framework component hint + normalized \`sourceFile\` path
   - Full distilled \`computedStyles\` (typography, flex/grid layout, surfaces, gradients, \`backdropFilter\`)
   - \`hoverState\` delta + CSS \`transition\`
   - Deduplicated \`subtreeSummary\` + \`<svg>\` (inline markup when <= 2 KB) and \`<img>\` asset metadata
   - Scoped semantic DOM tree + cropped PNG screenshot

### Workflow B: Cross-Tab Reference Comparison (A vs B) & Design DNA
When replicating or aligning with a reference website in another tab:
1. Switch to reference tab or extract its Design DNA directly:
   \`\`\`typescript
   spector_tabs({ action: "list" })
   spector_tabs({ action: "select", url: "*reference-site*" })
   spector_extract_tokens()
   \`\`\`
2. Developer pins **Ref (B)** on the reference tab and **Target (A)** on the local project tab using \`Alt + P\` (or AI triggers \`spector_picker({ action: "pick", role: "reference" })\` / \`spector_picker({ action: "pick", role: "target" })\`).
3. Call \`spector_picker({ action: "get", includeHoverState: true })\` to receive both pins plus a computed \`comparison\` diff (\`dimensionDelta\`, \`styleDiffs\`, \`hoverDiffs\`).

### Workflow C: Unified Layout Forensics, CSS Cascade & Runtime Health
When CSS is not behaving as expected (horizontal scrollbars, sticky not sticking, z-index hidden, broken images/fonts, or runtime errors):
\`\`\`typescript
spector_diagnose({
  selector: "#problem-element",
  breakpoints: ["mobile", "tablet", "desktop"],
  consoleLevel: "error",
  clearLogs: true
})
\`\`\`
Returns:
- Deduplicated console errors + failed network requests (\`>= 400\` or \`requestfailed\`, pathname-only)
- Horizontal overflow culprits, sticky/content clipping traps, z-index stacking traps, broken media, and font errors
- CDP CSS cascade breakdown (winning rule vs overridden rules)
- Multi-breakpoint overflow summary (automatically restores original viewport)

### Workflow D: Multi-Breakpoint Visual Verification & Ephemeral CSS Preview
1. Test CSS ideas safely in the live tab before touching project files:
   \`\`\`typescript
   spector_preview_css({ action: "apply", css: ".hero-cta { padding: 14px 28px; }" })
   \`\`\`
   (Remember to run \`spector_preview_css({ action: "clear" })\` before final verification.)
2. Capture visual verification across viewports:
   \`\`\`typescript
   spector_capture_screenshot({ breakpoints: ["mobile", "desktop"] })
   \`\`\`

### Workflow E: Opening Interactive UI States & DOM Mapping
\`\`\`typescript
// Open a dropdown/hover menu or scroll a container
spector_interact({ action: "click", selector: "#dropdown-trigger", waitForTimeoutMs: 150 })
spector_interact({ action: "hover", selector: ".pricing-card" })

// Inspect semantic DOM hierarchy (preserves Tailwind utility classes)
spector_get_dom_tree({ selector: "#app", maxDepth: 6 })
\`\`\`

---

## 3. Playbook Guardrails

| Anti-Pattern | Why It Is Prohibited | Recommended Action |
| :--- | :--- | :--- |
| **Pixel Guessing from Screenshots** | Leads to wrong spacing, fonts, and colors. | Use \`spector_picker\` / \`spector_extract_tokens\`. |
| **Blind CSS Tweaks** | Misses clipping ancestors, cascade overrides, and mobile overflow. | Run \`spector_diagnose({ selector, breakpoints })\`. |
| **Guessing Selectors** | Fragile targeting. | Obtain selectors from \`spector_picker\` or \`spector_get_dom_tree\`. |
| **Forcing Re-Login** | Breaks developer auth session. | Reuse the attached physical Chrome CDP session. |
`;

export function handleInitCommand(): void {
  const cwd = process.cwd();
  console.log(`\n🚀 Initializing Spector ${SPECTOR_VERSION} in current workspace...`);
  console.log(`📁 Target directory: ${cwd}\n`);

  const createdPaths: string[] = [];

  const agentsSkillDir = path.join(cwd, '.agents', 'skills', 'spector-inspect');
  const agentsSkillFile = path.join(agentsSkillDir, 'SKILL.md');

  try {
    fs.mkdirSync(agentsSkillDir, { recursive: true });
    fs.writeFileSync(agentsSkillFile, SPECTOR_SKILL_CONTENT, 'utf8');
    createdPaths.push(path.relative(cwd, agentsSkillFile));
  } catch (err: unknown) {
    console.error(`❌ Failed to write ${agentsSkillFile}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const cursorDir = path.join(cwd, '.cursor');
  if (fs.existsSync(cursorDir)) {
    const cursorSkillDir = path.join(cursorDir, 'skills', 'spector-inspect');
    const cursorSkillFile = path.join(cursorSkillDir, 'SKILL.md');
    try {
      fs.mkdirSync(cursorSkillDir, { recursive: true });
      fs.writeFileSync(cursorSkillFile, SPECTOR_SKILL_CONTENT, 'utf8');
      createdPaths.push(path.relative(cwd, cursorSkillFile));
    } catch {
      // Ignore optional cursor skill write error
    }
  }

  for (const p of createdPaths) {
    console.log(`  ✅ Injected: ${p}`);
  }

  console.log(`
🎉 Spector skill successfully initialized!

Next Step: Add Spector to your MCP Client Configuration:

  "mcpServers": {
    "spector": {
      "command": "npx",
      "args": ["-y", "@dimassetoid/spector", "serve"]
    }
  }

💡 Tip: Start Google Chrome with:
  chrome --remote-debugging-port=9222
or simply call any spector tool; Spector will automatically launch Chrome for you!
`);
}

export function handleHelpCommand(): void {
  console.log(`
spector — Perceptual Design & UI Forensics Compiler MCP Server

Usage:
  spector [command] [options]
  npx @dimassetoid/spector [command]

Commands:
  serve         Start the MCP server over stdio (standard startup command)
  init          Inject spector-inspect SKILL.md into .agents/skills/ in current project

Options:
  --profile <forensics|full>  Tool profile for serve (default: forensics; use full for navigate/dom_tree/interact)
  --help, -h                  Show this help message
  --version, -v               Show version

Use spector serve in your MCP client configuration. The client launches Spector
and communicates through stdin/stdout; no HTTP listener is opened.
Running without arguments remains a compatibility alias for serve.
`);
}
