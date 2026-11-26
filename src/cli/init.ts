import fs from 'node:fs';
import path from 'node:path';
import { SPECTOR_VERSION } from '../constants.js';

export const SPECTOR_SKILL_CONTENT = `---
name: spector-inspect
description: Live browser sharing, physical Chrome CDP attachment, Alt+P Design Blueprint extraction (typography, subtree summary, :hover/:focus-visible deltas, auto-forensics), multi-pin A/B comparison, Before/After verification, compact layout/a11y/cascade forensics with Vue/React sourceFile mapping, and multi-breakpoint screenshots using Spector.
---

# Skill: Spector Browser Inspector (\`spector-inspect\`)

> Use this skill when working with the developer's live Google Chrome session via **Spector** — a **6-tool Human-to-AI Visual Annotation & UI Forensics MCP Server** over Chrome DevTools Protocol (CDP). Works across Vue, Nuxt, React, Next.js, Svelte, and plain HTML.

---

## 1. Core Operating Principles

1. **Physical Chrome Reality (CDP First):**
   - Spector attaches directly to local Chrome via CDP (\`http://localhost:9222\` or \`ws://127.0.0.1:...\`).
   - Cookies, auth sessions, and local domains (\`localhost:port\`, \`.test\`, Docker) are preserved; disconnecting never closes Chrome.
   - When paired with \`agent-browser\`, delegate multi-step forms or E2E flows to \`agent-browser\`, then sync the active tab with \`spector_tabs({ action: "select", latest: true })\`.
2. **Point-and-Prompt Fast Path:**
   - Whenever the user refers to *"the element I clicked"*, *"compare this with that"*, or pinned items via \`Alt + P\`, **always call \`spector_picker({ action: "get" })\` first**.
3. **Structured Forensics & Compact Context:**
   - \`spector_diagnose\` defaults to \`detail: "compact"\` (grouping repetitive findings by selector pattern) and \`clearLogs: false\` (preserving buffered runtime logs across calls).
   - Use \`sourceFile\` (dev-mode Vue 3/Nuxt, React 17/18 \`_debugSource\`, React 19 \`_debugStack\`) and \`delta\` (session before/after diff) to jump straight to source files and verify fixes.

---

## 2. Tool Map (6 Core Tools)

| Tool | Role |
| :--- | :--- |
| \`spector_attach\` | Connects to local Chrome CDP (\`cdpUrl\`, \`autoSelectActiveTab\`, \`autoLaunch\`). |
| \`spector_tabs\` | Lists open tabs (\`"list"\`), switches active tab (\`"select"\`), reloads (\`"reload"\`), or navigates local dev / same-origin routes (\`"navigate"\`, \`clearLogsOnNavigate: true\` default). |
| \`spector_picker\` | Retrieves \`Alt+P\` Design Blueprints + auto-forensics (\`"get"\`), opens overlay (\`"pick"\`), snapshots a selector (\`"snapshot"\`), verifies Before vs After diffs (\`"verify"\`), or clears the pin queue (\`"clear"\`). |
| \`spector_diagnose\` | Runs grouped (\`detail: "compact"\`) layout/scroll/clipping forensics (\`internalHorizontalScroll\`, \`clippedInViewport\`), WCAG AA contrast & mobile touch targets (\`viewport\`, \`breakpoints\`), DOM→\`sourceFile\` mapping, optional design tokens (\`includeTokens\`), CDP CSS cascade (\`selector\`), session \`delta\`, and scoped console/network logs (\`runtimeScope: "current-document" | "active-tab" | "browser-session"\`). |
| \`spector_capture_screenshot\` | Captures element, viewport, full-page, \`mobile\`/\`tablet\`/\`desktop\` breakpoints, and batch \`colorSchemes: ["light", "dark"]\` PNGs with optional \`hideDevtoolsOverlays\` / \`hideSelectors\` and automatic viewport & media restoration. |
| \`spector_interact\` | Triggers lightweight UI states (\`click\`, \`hover\`, \`scrollTo\`) to open dropdowns, tabs, modals, or scroll sections during visual audits. |

---

## 3. Common Workflows

- **Point-and-Prompt + Verify:** \`spector_picker({ action: "get", includeHoverState: true })\` → edit code → \`spector_picker({ action: "verify" })\`.
- **Full Page Audit:** \`spector_diagnose({ breakpoints: ["mobile", "desktop"], runtimeScope: "current-document" })\` → edit code → re-run \`spector_diagnose\` to inspect the \`delta\` block.
- **Clean Multi-Theme Screenshot:** \`spector_capture_screenshot({ breakpoints: ["mobile", "desktop"], colorSchemes: ["light", "dark"], hideDevtoolsOverlays: true })\`.
`;

export function handleInitCommand(): void {
  const cwd = process.cwd();
  console.log(`\nInitializing Spector ${SPECTOR_VERSION} in current workspace...`);
  console.log(`Target directory: ${cwd}\n`);

  const createdPaths: string[] = [];
  const agentsSkillDir = path.join(cwd, '.agents', 'skills', 'spector-inspect');
  const agentsSkillFile = path.join(agentsSkillDir, 'SKILL.md');

  try {
    fs.mkdirSync(agentsSkillDir, { recursive: true });
    fs.writeFileSync(agentsSkillFile, SPECTOR_SKILL_CONTENT, 'utf8');
    createdPaths.push(path.relative(cwd, agentsSkillFile));
  } catch (err: unknown) {
    console.error(`Failed to write ${agentsSkillFile}: ${err instanceof Error ? err.message : String(err)}`);
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
    console.log(`  Created: ${p}`);
  }

  console.log(`
Next Step: Add Spector to your MCP Client Configuration:

  "mcpServers": {
    "spector": {
      "command": "npx",
      "args": ["-y", "@dimassetoid/spector", "serve"]
    }
  }
`);
}

export function handleHelpCommand(): void {
  console.log(`
spector — Human-to-AI Visual Annotation & CSS Forensics MCP Server

Usage:
  spector [command] [options]
  npx @dimassetoid/spector [command]

Commands:
  serve         Start the MCP server over stdio (standard startup command)
  init          Inject spector-inspect SKILL.md into .agents/skills/ in current project

Options:
  --help, -h    Show this help message
  --version, -v Show version

Use spector serve in your MCP client configuration. The client launches Spector
and communicates through stdin/stdout; no HTTP listener is opened.
Running without arguments remains a compatibility alias for serve.
`);
}
