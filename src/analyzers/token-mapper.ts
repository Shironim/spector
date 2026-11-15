import type { DesignTokensResult } from '../types.js';

const TAILWIND_RADII: Record<string, string> = {
  '2px': 'rounded-sm',
  '4px': 'rounded',
  '6px': 'rounded-md',
  '8px': 'rounded-lg',
  '12px': 'rounded-xl',
  '16px': 'rounded-2xl',
  '24px': 'rounded-3xl',
  '9999px': 'rounded-full'
};

const TAILWIND_FONT_SIZES: Record<string, string> = {
  '12px': 'text-xs',
  '14px': 'text-sm',
  '16px': 'text-base',
  '18px': 'text-lg',
  '20px': 'text-xl',
  '24px': 'text-2xl',
  '30px': 'text-3xl',
  '36px': 'text-4xl',
  '48px': 'text-5xl',
  '60px': 'text-6xl',
  '72px': 'text-7xl'
};

const TAILWIND_CONTAINER_WIDTHS: Record<string, string> = {
  '448px': 'max-w-md',
  '512px': 'max-w-lg',
  '576px': 'max-w-xl',
  '640px': 'max-w-screen-sm',
  '672px': 'max-w-2xl',
  '768px': 'max-w-screen-md',
  '896px': 'max-w-4xl',
  '1024px': 'max-w-screen-lg',
  '1152px': 'max-w-6xl',
  '1280px': 'max-w-screen-xl',
  '1536px': 'max-w-screen-2xl'
};

export function normalizeCssColor(raw: string): string | null {
  const val = raw.trim().toLowerCase();
  const hexMatch = val.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hexMatch) {
    const h = hexMatch[1];
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const rgbMatch = val.match(/^rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/);
  if (rgbMatch) {
    const alpha = rgbMatch[4];
    if (alpha === undefined || alpha === '1' || alpha === '100%') {
      return `rgb(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]})`;
    }
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }
  return null;
}

function normalizeTokenValue(raw: string): string {
  return normalizeCssColor(raw) ?? raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildTokenMap(tokens: DesignTokensResult): DesignTokensResult['tokenMap'] | undefined {
  const varLookup = new Map<string, string>();
  for (const [varName, varValue] of Object.entries(tokens.cssVariables || {})) {
    const norm = normalizeTokenValue(varValue);
    if (!varLookup.has(norm)) {
      varLookup.set(norm, `var(${varName})`);
    }
  }

  const cssVarMatches: Record<string, string> = {};
  const tailwindHints: Record<string, string> = {};

  const checkVar = (raw: string) => {
    const matched = varLookup.get(normalizeTokenValue(raw));
    if (matched) cssVarMatches[raw] = matched;
  };

  for (const group of Object.values(tokens.palette)) {
    for (const color of group) checkVar(color);
  }
  for (const radius of tokens.radii) {
    checkVar(radius);
    if (TAILWIND_RADII[radius]) tailwindHints[radius] = TAILWIND_RADII[radius];
  }
  for (const shadow of tokens.shadows) {
    checkVar(shadow);
  }
  for (const width of tokens.containerWidths) {
    checkVar(width);
    if (TAILWIND_CONTAINER_WIDTHS[width]) tailwindHints[width] = TAILWIND_CONTAINER_WIDTHS[width];
  }
  for (const item of tokens.typography.scale) {
    if (TAILWIND_FONT_SIZES[item.fontSize]) {
      tailwindHints[item.fontSize] = TAILWIND_FONT_SIZES[item.fontSize];
    }
  }

  const hasVars = Object.keys(cssVarMatches).length > 0;
  const hasTw = Object.keys(tailwindHints).length > 0;
  if (!hasVars && !hasTw) return undefined;

  return {
    ...(hasVars ? { cssVarMatches } : {}),
    ...(hasTw ? { tailwindHints } : {})
  };
}
