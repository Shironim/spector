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
  targetId?: string;
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
  targetId?: string;
  error?: string;
}

export interface EmulatedMediaOptions {
  colorScheme?: 'light' | 'dark';
  reducedMotion?: boolean;
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

export interface TabSelectCriteria {
  index?: number;
  url?: string;
  title?: string;
  latest?: boolean;
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

export interface PinLayoutIssue {
  kind: 'horizontal-overflow' | 'sticky-clipped-by-ancestor' | 'content-clipped' | 'stacking-trap' | 'inactive-css';
  detail: string;
  ancestorSelector?: string;
}

export interface PinForensicsSummary {
  overriddenCss?: Record<string, {
    winningValue?: string;
    winningSource?: string;
    overriddenCount: number;
    topOverridden: { value: string; source: string; reason: string };
  }>;
  layoutIssues?: PinLayoutIssue[];
}

export interface PinVerificationReport {
  status: 'verified' | 'element_not_found';
  pinId?: string;
  selector: string;
  note?: string;
  changed: boolean;
  rectDelta?: {
    xDiff: number;
    yDiff: number;
    widthDiff: number;
    heightDiff: number;
    before: BoundingRect;
    after: BoundingRect;
  };
  styleChanges: Record<string, { before?: string; after?: string }>;
  forensicsDelta?: {
    resolvedIssues: string[];
    remainingIssues: string[];
    newIssues: string[];
  };
  afterForensics?: PinForensicsSummary;
  verifiedAt: string;
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
  forensics?: PinForensicsSummary;
  domTree?: string;
  screenshotBase64?: string;
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
  scope: 'document-light-dom' | 'scoped-light-dom';
  rootSelector?: string;
  candidateElements: number;
  visitedElements: number;
  skippedHiddenElements?: number;
  elementLimitReached: boolean;
  excluded: string[];
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
  winningValue?: string;
  winningSource?: string;
  computedValue?: string;
  resolution: 'ranked' | 'partial';
  limitation?: string;
  authoredDeclarations?: Array<{ value: string; source: string; important: boolean }>;
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
  note?: string;
  computedSummary?: Record<string, string>;
  pseudoElements?: {
    before?: Record<string, CssCascadeEntry>;
    after?: Record<string, CssCascadeEntry>;
  };
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
  touchTargetIssuesCount?: number;
  targetLayout?: BreakpointTargetLayout;
}

export interface ContrastIssueItem {
  selector: string;
  textSample: string;
  color: string;
  backgroundColor: string;
  ratio: number;
  requiredRatio: number;
  fontSize: string;
  fontWeight: string;
}

export interface TouchTargetIssueItem {
  selector: string;
  tag: string;
  width: number;
  height: number;
  minRequired: number;
}

export interface MissingNameIssueItem {
  selector: string;
  tag: string;
  role?: string;
  reason: string;
}

export interface HeadingIssueItem {
  selector: string;
  tag: string;
  issue: 'multiple-h1' | 'skipped-level';
  detail: string;
}

export interface AccessibilityForensicsReport {
  coverage: {
    scope: 'document-light-dom' | 'scoped-light-dom';
    rootSelector?: string;
    scannedElements: number;
    skippedHiddenElements?: number;
    unverifiableContrastCount: number;
    touchTargetsChecked: boolean;
    issueLimitPerCategory: number;
  };
  contrastIssues: ContrastIssueItem[];
  touchTargetIssues: TouchTargetIssueItem[];
  missingNames: MissingNameIssueItem[];
  headingIssues: HeadingIssueItem[];
}

export interface TokenFrequencyItem {
  value: string;
  count: number;
}

export interface DesignTokenAuditReport {
  coverage: {
    scope: 'document-light-dom' | 'scoped-light-dom';
    rootSelector?: string;
    scannedElements: number;
    skippedHiddenElements?: number;
    limitReached: boolean;
  };
  typography: {
    uniqueFontFamilies: string[];
    fontSizes: TokenFrequencyItem[];
    fontWeights: TokenFrequencyItem[];
  };
  colors: {
    backgrounds: TokenFrequencyItem[];
    textColors: TokenFrequencyItem[];
    borderColors: TokenFrequencyItem[];
  };
  radii: TokenFrequencyItem[];
  spacing: {
    paddings: TokenFrequencyItem[];
    gaps: TokenFrequencyItem[];
  };
  cssVariables: Record<string, string>;
  slopSignals: string[];
}

export interface DiagnoseReport {
  url: string;
  viewport: { width: number; height: number } | null;
  runtimeHealth: {
    scope?: 'active-tab' | 'browser-session';
    consoleErrors: ConsoleLogEntry[];
    failedNetwork: NetworkLogEntry[];
  };
  layoutForensics: LayoutForensicsReport;
  accessibility?: AccessibilityForensicsReport;
  designTokens?: DesignTokenAuditReport;
  cssCascade?: CssCascadeReport;
  breakpointAudits?: BreakpointAuditItem[];
}

export type SpectorErrorCode =
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'TARGET_CHANGED'
  | 'VIEWPORT_RESTORE_FAILED'
  | 'NAVIGATION_DENIED'
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
