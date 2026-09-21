import type { Scope, Sensitivity } from './types.js';

export const pageTypes = ['source', 'entity', 'concept', 'synthesis', 'comparison', 'query'] as const;
export type WikiPageType = (typeof pageTypes)[number];

export interface WikiPageDraft {
  key: string;
  pageType: WikiPageType;
  title: string;
  summary: string;
  body: string;
  evidenceIds: string[];
  links: string[];
  status: 'active' | 'conflicted';
  conditions: string[];
  uncertainty: string[];
  expiresAt?: string | undefined;
}

export interface WikiPageMeta {
  id: string;
  type: 'wiki-page';
  key: string;
  pageType: WikiPageType;
  title: string;
  summary: string;
  scope: Scope;
  sensitivity: Sensitivity;
  revision: number;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'conflicted' | 'revoked';
  evidence: string[];
  links: string[];
  dependencies: Record<string, number>;
  rules: Record<string, number>;
  conditions: string[];
  uncertainty: string[];
  originHash?: string | undefined;
  expiresAt?: string | undefined;
}

export interface WikiRulesMeta {
  id: string;
  type: 'wiki-rules';
  scope: Scope;
  sensitivity: Sensitivity;
  revision: number;
  createdAt: string;
  updatedAt: string;
  purpose: string;
}

export interface WikiReceiptMeta {
  id: string;
  type: 'wiki-receipt';
  scope: Scope;
  sensitivity: Sensitivity;
  createdAt: string;
  updatedAt: string;
  signature: string;
  proof: string;
  planHash: string;
  sourceIds: string[];
  pageKeys: string[];
}

export interface WikiPlan {
  version: 1;
  vaultId: string;
  kind: 'compile' | 'file' | 'repair';
  sourceIds: string[];
  snapshot: Record<string, string>;
  configHash: string;
  contextKeys: string[];
  ruleIds: string[];
  /** Zero identifies a new target; positive values identify the revision being replaced. */
  expectedRevisions: Record<string, number>;
  relevantPageVersions: Record<string, number>;
  ruleVersions: Record<string, number>;
  /** SHA-256 of the complete canonical plaintext source body, keyed by evidence ID. */
  sourceHashes: Record<string, string>;
  pages: WikiPageDraft[];
  receiptId?: string | undefined;
  proof: string;
  query?: { key: string; hash: string; generation: WikiGeneration } | undefined;
}

export interface WikiGeneration {
  vaultId: string;
  model: string;
  at: string;
}

export interface WikiCatalogEntry {
  id: string;
  key: string;
  pageType: WikiPageType;
  title: string;
  summary: string;
  path: string;
  revision: number;
  scope: Scope;
  sensitivity: Sensitivity;
  status: 'active' | 'conflicted' | 'revoked';
  links: string[];
  legacy: boolean;
}

export interface WikiCitation {
  key: string;
  id: string;
  path: string;
  revision: number;
  evidence: string[];
  conditions: string[];
  uncertainty: string[];
}

export interface WikiQueryResult {
  answer: string;
  citations: WikiCitation[];
  uncertainty: string[];
  snapshot: Record<string, string>;
  configHash: string;
  ruleIds: string[];
  ruleVersions: Record<string, number>;
  question: string;
  generation: WikiGeneration;
  proof: string;
}

export interface WikiLintIssue {
  kind: string;
  message: string;
  pageKeys: string[];
  evidenceIds: string[];
  pageVersions: Record<string, number>;
}

export interface WikiLintResult {
  issues: WikiLintIssue[];
  semantic: 'available' | 'unavailable' | 'not-requested' | 'failed';
  semanticError?: { code: string; message: string };
  ruleVersions?: Record<string, number>;
  plans: WikiPlan[];
  coverage: { pages: number; evidence: number };
}
