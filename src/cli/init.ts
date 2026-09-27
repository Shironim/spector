import fs from 'node:fs';
import path from 'node:path';

export const SPECTOR_SKILL_CONTENT = `---
name: spector-inspect
description: Live browser sharing, physical Chrome CDP attachment, token-lean Accessibility DOM tree extraction, in-browser Alt+P visual element inspection, React/Vue framework component tracing, semantic DOM diffing, and automated interaction using spector.
---

# Skill: Spector Browser Inspector (\`spector-inspect\`)

> Gunakan skill ini saat perlu berinteraksi dengan browser Google Chrome fisik developer secara live, mendiagnosa bug visual/layout, membaca elemen yang di-klik pengguna via hotkey **Alt + P**, mengaudit log network/console, mendeteksi nama komponen Vue/React, atau memverifikasi perbaikan UI secara hemat token via semantic DOM diffing.

---

## 1. Core Operating Principles

1. **Physical Browser Reality (CDP First):**
   - Spector selalu menumpang pada sesi browser fisik developer (\`http://localhost:9222\`).
   - Cookie login, session storage, CSRF token, dan routing lokal (\`localhost:port\`, domain \`.test\`, Docker container) terpelihara 100%. Tidak perlu login ulang.

2. **Zero-Token Waste (Accessibility Tree vs Raw HTML):**
   - Dilarang keras meminta atau membaca raw HTML \`outerHTML\`.
   - Gunakan \`spector_get_dom_tree\` yang menghasilkan representasi semantik ringkas terkompresi dengan bounding box \`[box=x,y,w,h]\` dan anotasi komponen \`[comp=<ComponentName>]\`.

3. **Point-and-Prompt Fast Path:**
   - Kapan pun developer menyebut *"elemen yang saya klik"*, *"tombol ini"*, atau meminta perbaikan tampilan setelah interaksi browser, **SELALU panggil \`spector_get_last_picked\` terlebih dahulu**.

---

## 2. Workflows & Decision Matrix

### Workflow A: Point-and-Prompt UI Debugging (Paling Sering Digunakan)
1. Developer menekan \`Alt + P\` di browser dan mengeklik elemen bermasalah.
2. AI memanggil:
   \`\`\`typescript
   spector_get_last_picked({ clearAfterRead: false })
   \`\`\`
3. AI menerima:
   - Selector presisi (misal: \`#cekservice > div > form > button\`)
   - Framework Component: Nama komponen & source file Vue/React otomatis jika terdeteksi (misal: \`componentName: "CheckoutButton"\`, \`sourceFile: "components/CheckoutButton.vue"\`)
   - Bounding rect (\`x\`, \`y\`, \`width\`, \`height\`)
   - Computed CSS (font, padding, margin, border-radius, shadows, layout)
   - Cropped screenshot visual (Base64 PNG)
   - Scoped semantic DOM sub-tree
4. AI langsung menuju file komponen yang relevan tanpa tebak-tebakan, lalu melakukan patch via \`replace_file_content\`.

### Workflow B: Eksplorasi Hierarki Halaman (DOM Mapping)
Saat perlu memahami susunan UI halaman yang sedang aktif:
\`\`\`typescript
// Eksplorasi seluruh halaman (hemat token)
spector_get_dom_tree()

// Eksplorasi scoped pada modal atau form tertentu
spector_get_dom_tree({ selector: "#modal-container", includeBoundingBox: true })
\`\`\`

### Workflow C: Diagnosa Kegagalan Form & Network Telemetry
Saat form tidak bereaksi, tombol macet, atau data gagal disimpan:
1. Periksa log network dengan filter error:
   \`\`\`typescript
   spector_get_network_logs({ statusFilter: "errors_only", clearAfterRead: true })
   \`\`\`
2. Periksa log konsol untuk uncaught runtime exceptions:
   \`\`\`typescript
   spector_get_console_logs({ level: "error", clearAfterRead: true })
   \`\`\`
3. Hubungkan error status (misal: 422 Unprocessable Entity atau 500 Internal Server Error) dengan payload request untuk menemukan root cause validasi backend.

### Workflow D: Multi-Tab & Project Switching
Jika developer memiliki beberapa tab proyek lokal sekaligus:
1. Pindai seluruh tab:
   \`\`\`typescript
   spector_list_tabs()
   \`\`\`
2. Alihkan fokus ke proyek yang ingin dikerjakan via substring atau regex:
   \`\`\`typescript
   // Pencocokan substring
   spector_select_tab({ url: "localhost:3000" })
   // Pencocokan regex presisi
   spector_select_tab({ urlPattern: "^https?:\\\\/\\\\/localhost:5173\\\\/dashboard" })
   // Pencocokan session ID multi-tool
   spector_select_tab({ debugSessionId: "session_123" })
   \`\`\`

### Workflow E: Verifikasi Visual Pixel-Perfect
Untuk memastikan perbaikan layout tidak merusak elemen sekitar:
\`\`\`typescript
// Screenshot elemen yang diperbaiki
spector_capture_screenshot({ selector: "#main-card" })

// Screenshot seluruh halaman
spector_capture_screenshot({ fullPage: true })
\`\`\`

### Workflow F: Otomatisasi Alur Pengguna (E2E Validation)
Simulasikan interaksi nyata untuk memvalidasi alur kerja:
\`\`\`typescript
// Isi input form
spector_interact({ action: "fill", selector: "#input-phone", text: "08123456789" })

// Klik tombol submit
spector_interact({ action: "click", selector: "button[type='submit']" })
\`\`\`

### Workflow G: Verifikasi Perubahan Cepat via Semantic Diff (Token Saver)
Gunakan sebelum dan sesudah mengedit kode UI untuk verifikasi instan tanpa menarik ulang seluruh DOM tree:
1. Rekam baseline:
   \`\`\`typescript
   spector_diff_dom({ resetBaseline: true })
   \`\`\`
2. Edit file kode frontend (Vue, React, Blade, CSS).
3. Bandingkan delta perubahannya:
   \`\`\`typescript
   spector_diff_dom()
   // Mengembalikan: elemen bertambah, terhapus, perubahan teks, dan pergeseran koordinat box
   \`\`\`
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
