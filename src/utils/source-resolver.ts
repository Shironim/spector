import fs from 'node:fs';
import path from 'node:path';
import type { SourceLocation } from '../types.js';

/**
 * Resolves a client-side component origin (Vite, Webpack, Inertia, React Fiber, Vue)
 * into a verified, clickable physical workspace file URI.
 */
export function resolveSourceLocation(
  rawSourceFile?: string,
  componentName?: string,
  sourceLine?: number,
  customRoots: string[] = []
): SourceLocation | undefined {
  const candidateRoots: string[] = [
    ...customRoots,
    process.cwd(),
    path.resolve(process.cwd(), '..')
  ].filter(Boolean);

  let targetPath: string | null = null;
  let cleanLine = sourceLine && sourceLine > 0 ? sourceLine : 1;

  // 1. Clean Vite / Webpack / Dev-server URL prefixes and query params
  if (rawSourceFile) {
    let cleaned = rawSourceFile
      .replace(/\?.*$/, '') // Strip Vite HMR query params like ?vue&type=script
      .replace(/^[a-zA-Z]+:\/\/[^/]+/, '') // Strip http://localhost:5173
      .replace(/^\/@fs\//, '') // Strip Vite /@fs/ prefix
      .replace(/^\/resources\//, 'resources/')
      .replace(/^\/src\//, 'src/');

    // Windows drive letter fix (e.g., C:/Users or /C:/Users)
    if (/^\/([a-zA-Z]:\/)/.test(cleaned)) {
      cleaned = cleaned.slice(1);
    }

    // Direct absolute path check
    if (path.isAbsolute(cleaned) && fs.existsSync(cleaned)) {
      targetPath = cleaned;
    } else {
      // Relative path resolution across candidate workspace roots
      for (const root of candidateRoots) {
        const candidate = path.resolve(root, cleaned);
        if (fs.existsSync(candidate)) {
          targetPath = candidate;
          break;
        }
      }
    }
  }

  // 2. If sourceFile was not directly resolvable, search workspace by componentName
  if (!targetPath && componentName && componentName !== 'Anonymous') {
    const candidateExtensions = ['.vue', '.tsx', '.jsx', '.svelte', '.blade.php'];
    const searchDirs = [
      'src/components',
      'src/views',
      'src/pages',
      'resources/js/Components',
      'resources/js/Pages',
      'resources/views',
      'components',
      'app',
      'src'
    ];

    for (const root of candidateRoots) {
      if (!fs.existsSync(root)) continue;

      for (const subDir of searchDirs) {
        const fullDir = path.resolve(root, subDir);
        if (!fs.existsSync(fullDir)) continue;

        for (const ext of candidateExtensions) {
          const directFile = path.join(fullDir, `${componentName}${ext}`);
          if (fs.existsSync(directFile)) {
            targetPath = directFile;
            break;
          }
          const indexFile = path.join(fullDir, componentName, `index${ext}`);
          if (fs.existsSync(indexFile)) {
            targetPath = indexFile;
            break;
          }
        }
        if (targetPath) break;
      }
      if (targetPath) break;
    }
  }

  if (!targetPath || !fs.existsSync(targetPath)) {
    if (rawSourceFile || componentName) {
      return {
        resolvedFile: rawSourceFile || componentName,
        line: cleanLine,
        verifiedOnDisk: false
      };
    }
    return undefined;
  }

  const normalizedAbs = targetPath.replace(/\\/g, '/');
  let relPath = normalizedAbs;
  for (const root of candidateRoots) {
    const normRoot = root.replace(/\\/g, '/');
    if (normalizedAbs.startsWith(normRoot + '/')) {
      relPath = normalizedAbs.slice(normRoot.length + 1);
      break;
    }
  }

  // Generate clickable markdown URL scheme (POSIX lowercased drive letter for Windows)
  let fileUrlPath = normalizedAbs;
  if (/^[a-zA-Z]:/.test(fileUrlPath)) {
    fileUrlPath = fileUrlPath.charAt(0).toLowerCase() + fileUrlPath.slice(1);
  }
  const fileUrl = `file:///${fileUrlPath}#L${cleanLine}`;

  // Read snippet around target line if feasible
  let snippet: string | undefined;
  try {
    const stat = fs.statSync(targetPath);
    if (stat.size <= 200000) { // <= 200 KB
      const content = fs.readFileSync(targetPath, 'utf8');
      const lines = content.split('\n');
      const startIdx = Math.max(0, cleanLine - 3);
      const endIdx = Math.min(lines.length, cleanLine + 2);
      const snippetLines: string[] = [];
      for (let i = startIdx; i < endIdx; i++) {
        const lineNum = i + 1;
        const marker = lineNum === cleanLine ? '>' : ' ';
        snippetLines.push(`${marker} ${lineNum.toString().padStart(4)} | ${lines[i]}`);
      }
      snippet = snippetLines.join('\n');
    }
  } catch {
    // Non-critical snippet read failure
  }

  return {
    resolvedFile: relPath,
    absolutePath: targetPath,
    fileUrl,
    line: cleanLine,
    verifiedOnDisk: true,
    snippet
  };
}
