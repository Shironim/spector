import { describe, it } from 'bun:test';
import assert from 'node:assert';
import path from 'node:path';
import { resolveSourceLocation } from '../../src/utils/source-resolver.js';

describe('Source Location Resolver (resolveSourceLocation)', () => {
  it('preserves POSIX leading slash for Vite /@fs/ paths', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const rawVitePath = `/@fs${pkgPath}?vue&type=script`;
    const result = resolveSourceLocation(rawVitePath, undefined, 5);

    assert.ok(result);
    assert.strictEqual(result.verifiedOnDisk, true);
    assert.strictEqual(result.absolutePath, pkgPath.replace(/\\/g, '/'));
    assert.strictEqual(result.line, 5);
  });

  it('formats POSIX fileUrl with exactly 3 slashes and #L anchor', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const result = resolveSourceLocation(pkgPath, undefined, 10);

    assert.ok(result?.fileUrl);
    assert.ok(result.fileUrl.startsWith('file:///'), `Expected fileUrl to start with file:///, got ${result.fileUrl}`);
    assert.ok(!result.fileUrl.startsWith('file:////'), `fileUrl has quadruple slashes: ${result.fileUrl}`);
    assert.ok(result.fileUrl.endsWith('#L10'), `Expected anchor #L10, got ${result.fileUrl}`);
  });

  it('handles non-existent files gracefully without crashing', () => {
    const result = resolveSourceLocation('/non/existent/Component.vue', 'NonExistent', 42);

    assert.ok(result);
    assert.strictEqual(result.verifiedOnDisk, false);
    assert.strictEqual(result.line, 42);
  });

  it('embeds source snippet around target line with marker', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const result = resolveSourceLocation(pkgPath, undefined, 2);

    assert.ok(result?.snippet);
    assert.ok(result.snippet.includes('>'), 'Snippet should have target line marker');
    assert.ok(result.snippet.includes('name'), 'Snippet should contain package.json contents');
  });

  it('returns undefined when neither sourceFile nor componentName is provided', () => {
    const result = resolveSourceLocation(undefined, undefined);
    assert.strictEqual(result, undefined);
  });
});
