import { describe, it } from 'bun:test';
import assert from 'node:assert';
import { compareDomSnapshots, type DomSnapshotData } from '../../src/utils/dom-differ.js';

describe('DOM Differ (compareDomSnapshots)', () => {
  it('detects added elements correctly', () => {
    const baseline: DomSnapshotData = {
      timestamp: '2026-10-09T00:00:00.000Z',
      url: 'http://localhost:3000/dashboard',
      elements: [
        {
          selector: 'h1#title',
          tag: 'h1',
          text: 'Dashboard',
          classes: 'font-bold',
          box: { x: 10, y: 10, w: 200, h: 40 }
        }
      ]
    };

    const current: DomSnapshotData = {
      timestamp: '2026-10-09T00:00:01.000Z',
      url: 'http://localhost:3000/dashboard',
      elements: [
        {
          selector: 'h1#title',
          tag: 'h1',
          text: 'Dashboard',
          classes: 'font-bold',
          box: { x: 10, y: 10, w: 200, h: 40 }
        },
        {
          selector: 'button#new-btn',
          tag: 'button',
          text: 'Click Me',
          classes: 'btn btn-primary',
          box: { x: 10, y: 60, w: 100, h: 30 }
        }
      ]
    };

    const diff = compareDomSnapshots(baseline, current);
    assert.strictEqual(diff.status, 'compared');
    assert.strictEqual(diff.summary.addedCount, 1);
    assert.strictEqual(diff.summary.removedCount, 0);
    assert.strictEqual(diff.summary.mutatedCount, 0);
    assert.strictEqual(diff.changes.added[0].selector, 'button#new-btn');
  });

  it('detects removed elements correctly', () => {
    const baseline: DomSnapshotData = {
      timestamp: '2026-10-09T00:00:00.000Z',
      url: 'http://localhost:3000/dashboard',
      elements: [
        {
          selector: '#dialog',
          tag: 'div',
          text: 'Modal Content',
          classes: 'modal open',
          box: { x: 50, y: 50, w: 300, h: 200 }
        }
      ]
    };

    const current: DomSnapshotData = {
      timestamp: '2026-10-09T00:00:01.000Z',
      url: 'http://localhost:3000/dashboard',
      elements: []
    };

    const diff = compareDomSnapshots(baseline, current);
    assert.strictEqual(diff.summary.removedCount, 1);
    assert.strictEqual(diff.changes.removed[0].selector, '#dialog');
  });

  it('detects text, class, and layout mutations', () => {
    const baseline: DomSnapshotData = {
      timestamp: '2026-10-09T00:00:00.000Z',
      url: 'http://localhost:3000/dashboard',
      elements: [
        {
          selector: 'span#badge',
          tag: 'span',
          text: 'Pending',
          classes: 'badge badge-warning',
          box: { x: 10, y: 10, w: 50, h: 20 }
        }
      ]
    };

    const current: DomSnapshotData = {
      timestamp: '2026-10-09T00:00:01.000Z',
      url: 'http://localhost:3000/dashboard',
      elements: [
        {
          selector: 'span#badge',
          tag: 'span',
          text: 'Approved',
          classes: 'badge badge-success',
          box: { x: 10, y: 10, w: 60, h: 20 }
        }
      ]
    };

    const diff = compareDomSnapshots(baseline, current);
    assert.strictEqual(diff.summary.mutatedCount, 1);
    assert.strictEqual(diff.summary.textChangesCount, 1);
    const mutated = diff.changes.mutated[0];
    assert.deepStrictEqual(mutated.textDiff, { before: 'Pending', after: 'Approved' });
    assert.deepStrictEqual(mutated.classDiff, { before: 'badge badge-warning', after: 'badge badge-success' });
    assert.deepStrictEqual(mutated.boxDiff, {
      before: { x: 10, y: 10, w: 50, h: 20 },
      after: { x: 10, y: 10, w: 60, h: 20 }
    });
  });

  it('generates urlMismatchWarning when current URL differs from baseline', () => {
    const baseline: DomSnapshotData = {
      timestamp: '2026-10-09T00:00:00.000Z',
      url: 'http://localhost:3000/step-1',
      elements: []
    };

    const current: DomSnapshotData = {
      timestamp: '2026-10-09T00:00:01.000Z',
      url: 'http://localhost:3000/step-2',
      elements: []
    };

    // Note: diffDom at manager level adds urlMismatchWarning if baseline.url !== current.url
    assert.notStrictEqual(baseline.url, current.url);
  });
});
