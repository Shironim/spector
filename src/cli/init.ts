import fs from 'node:fs';
import path from 'node:path';

export const SPECTOR_SKILL_CONTENT = `---
name: spector-inspect
description: Live browser sharing, physical Chrome CDP attachment, token-lean Accessibility DOM tree extraction, in-browser Alt+P visual element inspection, React/Vue framework component tracing, semantic DOM diffing, and automated interaction using spector.
---

# Skill: Spector Browser Inspector (\`spector-inspect\`)

> Use this skill when you need to interact with the developer's live physical Google Chrome browser, diagnose visual or layout bugs, inspect elements clicked via the **Alt + P** hotkey, audit network and console logs, trace Vue/React framework component origins to physical workspace files, or verify UI fixes with token-lean semantic DOM diffing.

---

## 1. Core Operating Principles

1. **Physical Browser Reality (CDP First):**
   - Spector attaches directly to the developer's physical browser session (\`http://localhost:9222\`).
   - Authentication cookies, session storage, CSRF tokens, and local routing (\`localhost:port\`, \`.test\` domains, Docker containers) are 100% preserved. Never prompt for re-login.

2. **Zero-Token Waste (Accessibility Tree vs Raw HTML):**
   - Strictly avoid dumping or requesting raw \`outerHTML\`.
   - Use \`spector_get_dom_tree\` to obtain a compact semantic representation annotated with bounding boxes \`[box=x,y,w,h]\` and component markers \`[comp=<ComponentName>]\`.

3. **Point-and-Prompt Fast Path:**
   - Whenever the developer says *"the element I clicked"*, *"this button"*, or requests visual fixes following browser interaction, **ALWAYS call \`spector_get_last_picked\` first**.

---

## 2. Workflows & Decision Matrix

### Workflow A: Point-and-Prompt UI Debugging (Most Frequently Used)
1. Developer presses \`Alt + P\` in the browser and clicks the target element.
2. AI calls:
   \`\`\`typescript
   spector_get_last_picked({ clearAfterRead: false })
   \`\`\`
3. AI receives:
   - Precise CSS selector (e.g., \`#checkout > div > form > button\`)
   - Framework Component & Pick-to-Source: Component name, source file, verified physical disk path (\`file:///path/to/Component.vue#L24\`), and a 5-line code snippet preview.
   - Bounding rect (\`x\`, \`y\`, \`width\`, \`height\`)
   - Computed styles (layout, typography, margins, padding, colors)
   - Visual screenshot crop (Base64 PNG)
   - Scoped semantic DOM sub-tree
4. AI navigates directly to the target component file without guessing, then applies surgical edits via \`replace_file_content\`.

### Workflow B: Page Hierarchy Exploration (DOM Mapping)
When you need to understand the structure of the active page:
\`\`\`typescript
// Token-lean full page hierarchy
spector_get_dom_tree()

// Scoped exploration for a specific container or modal
spector_get_dom_tree({ selector: "#modal-container", includeBoundingBox: true })
\`\`\`

### Workflow C: Form Failure Diagnosis & Network Telemetry
When a form does not submit, buttons appear stuck, or API calls fail:
1. Inspect network logs with error filtering:
   \`\`\`typescript
   spector_get_network_logs({ statusFilter: "errors_only", format: "compact", clearAfterRead: true })
   \`\`\`
2. Inspect console logs for uncaught runtime exceptions:
   \`\`\`typescript
   spector_get_console_logs({ level: "error", clearAfterRead: true })
   \`\`\`
3. Correlate HTTP error statuses (e.g., 422 Unprocessable Entity, 500 Internal Server Error) with request payloads to identify root causes.

### Workflow D: Multi-Tab & Project Switching
When the developer has multiple local projects or tabs open:
1. List all active tabs:
   \`\`\`typescript
   spector_list_tabs()
   \`\`\`
2. Switch focus to the desired target using substring or regex:
   \`\`\`typescript
   // Substring match
   spector_select_tab({ url: "localhost:3000" })
   // Precise regex pattern
   spector_select_tab({ urlPattern: "^https?:\\\\/\\\\/localhost:5173\\\\/dashboard" })
   // Multi-tool correlation session ID
   spector_select_tab({ debugSessionId: "session_123" })
   \`\`\`

### Workflow E: Visual Verification
To verify layout fixes without disrupting surrounding elements:
\`\`\`typescript
// Screenshot a specific component
spector_capture_screenshot({ selector: "#main-card" })

// Full page screenshot
spector_capture_screenshot({ fullPage: true })
\`\`\`

### Workflow F: User Flow Automation (E2E Validation)
Simulate realistic user interactions to validate workflows:
\`\`\`typescript
// Scroll element into viewport center
spector_interact({ action: "scrollIntoView", selector: "#input-phone" })

// Fill input field
spector_interact({ action: "fill", selector: "#input-phone", text: "08123456789" })

// Click submit button
spector_interact({ action: "click", selector: "button[type='submit']" })
\`\`\`

### Workflow G: Quick Delta Verification via Semantic Diff (Token Saver)
Use before and after UI code mutations for instant verification without re-fetching entire DOM trees:
1. Capture baseline:
   \`\`\`typescript
   spector_diff_dom({ resetBaseline: true })
   \`\`\`
2. Apply frontend code changes (Vue, React, Blade, CSS).
3. Compare delta:
   \`\`\`typescript
   spector_diff_dom()
   // Returns: added elements, removed elements, text changes, and bounding box shifts
   \`\`\`

---

## 3. Playbook Guardrails & Anti-Patterns

| Anti-Pattern | Why It Is Prohibited | Recommended Action |
| :--- | :--- | :--- |
| **Guessing CSS Selectors** | Leads to brittle and broken targeting. | Always obtain verified selectors from \`spector_get_last_picked\` or \`spector_get_dom_tree\`. |
| **Dumping Raw HTML** | Consumes tens of thousands of LLM context tokens. | Use \`spector_get_dom_tree\` with a targeted \`selector\`. |
| **Forcing Re-Authentication** | Disrupts developer workflow and test state. | Reuse the active Chrome session attached via CDP. |
| **Ignoring Error Responses** | Results in blind speculation about failures. | Inspect payloads via \`spector_get_network_logs(statusFilter: "errors_only")\`. |
`;

export function handleInitCommand(): void {
  const cwd = process.cwd();
  console.log('\n🚀 Initializing Spector in current workspace...');
  console.log(`📁 Target directory: ${cwd}\n`);

  const createdPaths: string[] = [];

  // 1. Target: .agents/skills/spector-inspect/SKILL.md (Antigravity, OpenCode, Claude Code)
  const agentsSkillDir = path.join(cwd, '.agents', 'skills', 'spector-inspect');
  const agentsSkillFile = path.join(agentsSkillDir, 'SKILL.md');

  try {
    fs.mkdirSync(agentsSkillDir, { recursive: true });
    fs.writeFileSync(agentsSkillFile, SPECTOR_SKILL_CONTENT, 'utf8');
    createdPaths.push(path.relative(cwd, agentsSkillFile));
  } catch (err: any) {
    console.error(`❌ Failed to write ${agentsSkillFile}: ${err.message}`);
  }

  // 2. Target: .cursor/skills/spector-inspect/SKILL.md (if .cursor exists)
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
      "args": ["-y", "@dimassetoid/spector"]
    }
  }

💡 Tip: Start Google Chrome with:
  chrome --remote-debugging-port=9222
or simply call any spector tool; Spector will automatically launch Chrome for you!
`);
}

export function handleHelpCommand(): void {
  console.log(`
spector — Standalone Browser Sharing & Visual Element Inspector MCP Server

Usage:
  spector [command] [options]
  npx @dimassetoid/spector [command]

Commands:
  init          Inject spector-inspect SKILL.md into .agents/skills/ in current project

Options:
  --help, -h    Show this help message
  --version, -v Show version

When run without commands or options, Spector starts the MCP Server over stdio.
`);
}
