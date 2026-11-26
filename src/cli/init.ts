import fs from 'node:fs';
import path from 'node:path';
import { SPECTOR_VERSION } from '../constants.js';

export const SPECTOR_SKILL_CONTENT = `---
name: spector-inspect
description: Human-to-AI visual annotation (Alt+P overlay picker, A/B pin comparison) and CSS/layout forensics on the developer's live physical Chrome via CDP.
---

# Skill: Spector Visual Bridge (\`spector-inspect\`)

> Use this skill when working with the developer's live Google Chrome session via **Spector** — a Human-to-AI Visual Annotation & CSS Forensics Bridge.

## 1. Core Operating Principles

1. **Physical Chrome Reality (CDP First):**
   - Spector attaches directly to the developer's Chrome via CDP (\`http://localhost:9222\`).
   - Cookies, auth sessions, and local domains (\`localhost:port\`, \`.test\`) are preserved.
2. **Point-and-Prompt Fast Path:**
   - Whenever the user refers to *"the element I clicked"*, *"compare this with that"*, or pinned items via \`Alt + P\`, **always call \`spector_picker({ action: "get" })\` first**.
3. **Structured CSS Forensics over Pixel Guessing:**
   - Use \`spector_diagnose({ selector, breakpoints })\` to inspect CSS cascade winners/overrides, horizontal overflow culprits, sticky/clipping traps, z-index stacking traps, and active-tab console/network errors.

## 2. Core Tools (5 Tools)

- \`spector_attach\`: Connect to physical Chrome via CDP.
- \`spector_tabs\`: List open Chrome tabs or switch the active tab by index, URL, title, or \`latest: true\`.
- \`spector_picker\`: Retrieve \`Alt + P\` pinned blueprint(s) & A/B diffs (\`action: "get"\`), launch the interactive overlay (\`action: "pick"\`), or clear the pin queue (\`action: "clear"\`).
- \`spector_diagnose\`: Run layout traps, CDP CSS cascade analysis, multi-breakpoint overflow checks, and active-tab runtime errors.
- \`spector_capture_screenshot\`: Capture the active tab, a selector, or responsive breakpoints (\`mobile\`, \`tablet\`, \`desktop\`) with optional \`colorScheme\` / \`reducedMotion\` emulation.
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
