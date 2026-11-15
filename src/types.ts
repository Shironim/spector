export interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConsoleLogEntry {
  textTruncated?: boolean;
  originalTextLength?: number;
  type: string;
  text: string;
  timestamp: string;
  location?: string;
  count?: number;
}

export interface NetworkLogEntry {
  id: string;
  method: string;
  pathname: string;
  resourceType: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  timestamp: string;
  error?: string;
}

export interface ActiveTabInfo {
  title: string;
  url: string;
  viewport: {
    width: number;
    height: number;
  } | null;
  warning?: string;
}

export interface TabInfo {
  targetId?: string;
  index: number;
  title: string;
  url: string;
  isActive: boolean;
}

export type SpectorToolProfile = 'full' | 'forensics';

export interface TabSelectCriteria {
  index?: number;
  url?: string;
  title?: string;
  latest?: boolean;
}

export interface FrameworkComponentInfo {
  framework: 'vue' | 'react' | 'svelte' | 'livewire' | 'alpine' | 'inertia' | 'blade' | 'unknown';
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  props?: string[];
}

export interface TypographyCluster {
  role: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  color: string;
  count: number;
}

export interface SubtreeStyleSummary {
  typography: TypographyCluster[];
  surfaces: string[];
  radii: string[];
  spacingGaps: string[];
}

export interface SvgAssetItem {
  ariaLabel?: string;
  width: number;
  height: number;
  viewBox?: string;
  markup?: string;
  truncated?: boolean;
}

export interface ImageAssetItem {
  srcPath: string;
  alt?: string;
  naturalWidth: number;
  naturalHeight: number;
  renderWidth: number;
  renderHeight: number;
  broken?: boolean;
  aspectMismatch?: boolean;
}

export interface ElementAssetsMeta {
  svgs?: {
    count: number;
    items: SvgAssetItem[];
  };
  images?: {
    count: number;
    items: ImageAssetItem[];
  };
}

export interface PseudoStateDelta {
  pseudoState: ':hover' | ':focus-visible';
  changes: Record<string, { normal: string; active: string }>;
  transition?: {
    property?: string;
    duration?: string;
    timingFunction?: string;
  };
}

export type PinRole = 'single' | 'target' | 'reference' | 'pin';
export type PinSelectionMode = 'element' | 'region';

export interface AnimationKeyframeEntry {
  offset?: number | null;
  easing?: string;
  props: Record<string, string>;
}

export interface ElementAnimationInfo {
  selector?: string;
  type: 'css-animation' | 'css-transition' | 'waapi';
  name?: string;
  playState?: string;
  durationMs: number | 'auto';
  delayMs: number;
  iterations: number | 'Infinity';
  easing: string;
  direction?: string;
  fill?: string;
  keyframes?: AnimationKeyframeEntry[];
}

export interface StaggerPattern {
  name: string;
  count: number;
  stepMs: number;
  baseDelayMs: number;
  selectors: string[];
}

export interface AnimationForensicsReport {
  activeCount: number;
  animations: ElementAnimationInfo[];
  staggerPatterns?: StaggerPattern[];
}

export interface PickedElementInfo {
  documentId?: string;
  elementId?: string;
  enrichment?: Partial<Record<'hover' | 'focus', { status: 'captured' | 'failed' | 'stale' | 'unavailable'; observedAt?: string }>>;
  sections?: Partial<Record<'dom' | 'screenshot', { status: 'captured' | 'failed' | 'not_requested' | 'unavailable' }>>;
  targetId?: string;
  id?: string;
  role?: PinRole;
  pinMode?: PinSelectionMode;
  note?: string;
  tabUrl?: string;
  tabTitle?: string;
  status: 'selected' | 'cancelled' | 'timeout';
  selector?: string;
  tagName?: string;
  rect?: BoundingRect;
  computedStyles?: Record<string, string>;
  hoverState?: PseudoStateDelta;
  focusState?: PseudoStateDelta;
  subtreeSummary?: SubtreeStyleSummary;
  assets?: ElementAssetsMeta;
  animations?: ElementAnimationInfo[];
  domTree?: string;
  screenshotBase64?: string;
  frameworkComponent?: FrameworkComponentInfo;
  timestamp?: string;
}

export interface ComparisonDiff {
  targetId?: string;
  referenceId?: string;
  targetSelector?: string;
  referenceSelector?: string;
  dimensionDelta?: {
    widthDiff: number;
    heightDiff: number;
  };
  styleDiffs: Record<string, { target?: string; reference?: string }>;
  hoverDiffs?: Record<string, { target?: string; reference?: string }>;
}

export interface ScanCoverage {
  scope: 'document-light-dom';
  candidateElements: number;
  visitedElements: number;
  elementLimitReached: boolean;
  excluded: string[];
}

export interface DesignTokensResult {
  coverage?: ScanCoverage & { variablesAtLimit: boolean; variablesRequested: boolean };
  url: string;
  cssVariables: Record<string, string>;
  palette: {
    backgrounds: string[];
    surfaces: string[];
    texts: string[];
    accents: string[];
    borders: string[];
  };
  typography: {
    fontFamilies: string[];
    scale: Array<{
      fontSize: string;
      fontWeight: string;
      lineHeight: string;
      sampleTags: string[];
      count: number;
    }>;
  };
  radii: string[];
  shadows: string[];
  containerWidths: string[];
  tokenMap?: {
    cssVarMatches?: Record<string, string>;
    tailwindHints?: Record<string, string>;
  };
}

export interface OverflowCulprit {
  selector: string;
  overflowPx: number;
  rect: BoundingRect;
  reason: string;
}

export interface ClippingTrap {
  selector: string;
  issue: 'sticky-clipped-by-ancestor' | 'content-clipped';
  ancestorSelector?: string;
  ancestorOverflow?: string;
  rect: BoundingRect;
}

export interface StackingTrap {
  selector: string;
  zIndex: string;
  trappedInAncestor: string;
  ancestorContextReason: string;
}

export interface BrokenMediaItem {
  tag: 'img' | 'svg';
  selector: string;
  srcPath?: string;
  reason: string;
  naturalSize?: string;
  renderSize?: string;
}

export interface FontIssueItem {
  family: string;
  status: string;
  weight?: string;
  style?: string;
}

export interface InactiveCssHint {
  selector: string;
  property: string;
  value: string;
  reason: string;
}

export interface LayoutForensicsReport {
  coverage?: ScanCoverage & { issueLimitPerCategory: number; categoriesAtLimit: string[] };
  horizontalOverflow: {
    hasOverflow: boolean;
    scrollWidth: number;
    clientWidth: number;
    culprits: OverflowCulprit[];
  };
  clippingTraps: ClippingTrap[];
  stackingTraps: StackingTrap[];
  brokenMedia: BrokenMediaItem[];
  fontIssues: FontIssueItem[];
  inactiveCss: InactiveCssHint[];
}

export interface CssCascadeEntry {
  winningValue: string;
  winningSource: string;
  important?: boolean;
  overridden: Array<{
    value: string;
    source: string;
    reason: string;
  }>;
}

export interface CssCascadeReport {
  selector: string;
  properties: Record<string, CssCascadeEntry>;
}

export interface BreakpointTargetLayout {
  rect: BoundingRect;
  display: string;
  flexDirection?: string;
  gridTemplateColumns?: string;
  fontSize?: string;
  visibility?: string;
}

export interface BreakpointAuditItem {
  coverage?: LayoutForensicsReport['coverage'];
  breakpoint: string;
  width: number;
  height: number;
  hasHorizontalOverflow: boolean;
  overflowCulpritsCount: number;
  topCulprit?: string;
  targetLayout?: BreakpointTargetLayout;
}

export interface DiagnoseReport {
  url: string;
  viewport: { width: number; height: number } | null;
  runtimeHealth: {
    scope?: 'browser-session';
    consoleErrors: ConsoleLogEntry[];
    failedNetwork: NetworkLogEntry[];
  };
  layoutForensics: LayoutForensicsReport;
  cssCascade?: CssCascadeReport;
  animations?: AnimationForensicsReport;
  breakpointAudits?: BreakpointAuditItem[];
}

export type SpectorErrorCode =
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'TARGET_CHANGED'
  | 'VIEWPORT_RESTORE_FAILED'
  | 'CDP_ENDPOINT_DENIED'
  | 'INVALID_CDP_ENDPOINT'
  | 'BROWSER_CONTEXT_UNAVAILABLE'
  | 'CHROME_CDP_UNAVAILABLE'
  | 'BROWSER_NOT_ATTACHED'
  | 'NO_PICKED_ELEMENT'
  | 'PICKER_CANCELLED'
  | 'ELEMENT_NOT_READY'
  | 'TAB_NOT_FOUND'
  | 'OPERATION_TIMEOUT'
  | 'INVALID_TOOL_INPUT'
  | 'TOOL_OPERATION_FAILED';

export type McpToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface McpToolResponse {
  [x: string]: unknown;
  content: McpToolContent[];
  isError?: boolean;
}
