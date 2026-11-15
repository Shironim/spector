import { describe, it } from 'bun:test';
import assert from 'node:assert';
import { escapeTailwindSelector } from '../../src/utils/selector.js';

describe('Tailwind Selector Escaping (escapeTailwindSelector)', () => {
  it('escapes arbitrary value brackets', () => {
    assert.strictEqual(escapeTailwindSelector('.w-[200px]'), '.w-\\[200px\\]');
    assert.strictEqual(escapeTailwindSelector('.h-[50vh]'), '.h-\\[50vh\\]');
  });

  it('escapes arbitrary values with decimals and units', () => {
    assert.strictEqual(escapeTailwindSelector('.top-[1.5rem]'), '.top-\\[1\\.5rem\\]');
    assert.strictEqual(escapeTailwindSelector('.left-[0.25em]'), '.left-\\[0\\.25em\\]');
  });

  it('escapes percentage arbitrary values', () => {
    assert.strictEqual(escapeTailwindSelector('.w-[50%]'), '.w-\\[50\\%\\]');
    assert.strictEqual(escapeTailwindSelector('.max-w-[100%]'), '.max-w-\\[100\\%\\]');
  });

  it('escapes fractional classes', () => {
    assert.strictEqual(escapeTailwindSelector('.w-1/2'), '.w-1\\/2');
    assert.strictEqual(escapeTailwindSelector('.h-2/3'), '.h-2\\/3');
    assert.strictEqual(escapeTailwindSelector('.w-3/4'), '.w-3\\/4');
  });

  it('escapes decimal utility classes', () => {
    assert.strictEqual(escapeTailwindSelector('.p-1.5'), '.p-1\\.5');
    assert.strictEqual(escapeTailwindSelector('.m-0.5'), '.m-0\\.5');
    assert.strictEqual(escapeTailwindSelector('.gap-2.5'), '.gap-2\\.5');
  });

  it('escapes state variants with colons', () => {
    assert.strictEqual(escapeTailwindSelector('.hover:bg-blue-500'), '.hover\\:bg-blue-500');
    assert.strictEqual(escapeTailwindSelector('.focus:ring-2'), '.focus\\:ring-2');
    assert.strictEqual(escapeTailwindSelector('.dark:text-white'), '.dark\\:text-white');
  });

  it('leaves standard CSS class selectors untouched', () => {
    assert.strictEqual(escapeTailwindSelector('.btn-primary'), '.btn-primary');
    assert.strictEqual(escapeTailwindSelector('#submit-button'), '#submit-button');
    assert.strictEqual(escapeTailwindSelector('button.active'), 'button.active');
  });

  it('correctly handles compound selectors', () => {
    const input = 'div.w-1/2 > button.p-1.5.w-[200px]';
    const expected = 'div.w-1\\/2 > button.p-1\\.5.w-\\[200px\\]';
    assert.strictEqual(escapeTailwindSelector(input), expected);
  });
});
