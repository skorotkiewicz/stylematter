export interface StyleMatterNode {
  material: string;
  radius: number;
  padding: number;
}

export interface StyleMatterGapRelation {
  type: "gap";
  from: string;
  to: string;
  value: number;
}

export interface StyleMatterGraph {
  version: 2;
  materials: Record<string, string>;
  nodes: Record<string, StyleMatterNode>;
  relations: Record<string, StyleMatterGapRelation>;
}

export interface LegacyStyleMatterGraph {
  version: 1;
  materials: Record<string, string>;
  nodes: Record<string, StyleMatterNode>;
  gap: number;
}

export type PersistedStyleMatterGraph = StyleMatterGraph | LegacyStyleMatterGraph;
export type MaybePromise<T> = T | Promise<T>;

export interface AttachStyleMatterOptions {
  storageKey?: string;
  persistence?: boolean;
  loadGraph?: (key: string) => MaybePromise<unknown | null>;
  saveGraph?: (key: string, graph: StyleMatterGraph) => MaybePromise<boolean | void>;
}

export interface StyleMatterEditor {
  readonly ready: Promise<void>;
  readonly graph: StyleMatterGraph;
  undo(): boolean;
  redo(): boolean;
  save(): Promise<boolean>;
  destroy(): Promise<void>;
}

export function attachStyleMatter(root: Element, options?: AttachStyleMatterOptions): StyleMatterEditor;
export function clamp(value: number, min: number, max: number): number;
export function colorToHex(color: string): string;
export function isStyleMatterGraph(value: unknown): value is StyleMatterGraph;
export function isPersistedStyleMatterGraph(value: unknown): value is PersistedStyleMatterGraph;
export function normalizeGraph(saved: unknown, fallback: StyleMatterGraph): StyleMatterGraph;
