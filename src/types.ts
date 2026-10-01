export interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp: string;
  location?: string;
  count?: number;
}

export interface NetworkLogEntry {
  id: string;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  statusText?: string;
  contentType?: string;
  durationMs?: number;
  timestamp: string;
  error?: string;
  requestBodySummary?: string;
  responseBodySummary?: string;
}

export interface CompressedDomNode {
  tag: string;
  role?: string;
  name?: string;
  id?: string;
  classes?: string[];
  type?: string;
  value?: string;
  href?: string;
  placeholder?: string;
  ariaLabel?: string;
  box?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  children?: CompressedDomNode[];
}

export interface ActiveTabInfo {
  title: string;
  url: string;
  viewport: {
    width: number;
    height: number;
  } | null;
}

export interface TabInfo {
  index: number;
  title: string;
  url: string;
  isActive: boolean;
}

export interface SourceLocation {
  resolvedFile?: string;
  absolutePath?: string;
  fileUrl?: string; // Clickable markdown link format: file:///...#L12
  line?: number;
  verifiedOnDisk: boolean;
  snippet?: string;
}

export interface FrameworkComponentInfo {
  framework: 'vue' | 'react' | 'svelte' | 'angular' | 'livewire' | 'alpine' | 'inertia' | 'blade' | 'unknown';
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  props?: string[];
  sourceLocation?: SourceLocation;
}

export interface MockRouteRule {
  id: string;
  urlPattern: string;
  status: number;
  contentType?: string;
  body?: string;
  headers?: Record<string, string>;
  delayMs?: number;
  createdAt?: string;
}

export interface TabSelectCriteria {
  index?: number;
  url?: string;
  urlPattern?: string;
  title?: string;
  debugSessionId?: string;
}

export interface PickedElementInfo {
  status: 'selected' | 'cancelled' | 'timeout';
  selector?: string;
  tagName?: string;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  computedStyles?: Record<string, string>;
  domTree?: string;
  screenshotBase64?: string;
  frameworkComponent?: FrameworkComponentInfo;
  timestamp?: string;
}

export type McpToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface McpToolResponse {
  [x: string]: unknown;
  content: McpToolContent[];
  isError?: boolean;
}

export function textResponse(text: string, isError = false): McpToolResponse {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {})
  };
}

export function jsonResponse(data: unknown, isError = false): McpToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {})
  };
}


