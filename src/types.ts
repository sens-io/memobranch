export const scopes = ['user', 'project', 'team', 'public'] as const;
export type Scope = (typeof scopes)[number];

export const sensitivities = ['public', 'internal', 'sensitive', 'secret'] as const;
export type Sensitivity = (typeof sensitivities)[number];

export const memoryKinds = ['preference', 'fact', 'episode', 'procedure', 'decision'] as const;
export type MemoryKind = (typeof memoryKinds)[number];

export type CandidateStatus = 'pending' | 'promoted' | 'rejected';
export type MemoryStatus = 'active' | 'conflicted' | 'superseded' | 'revoked';

export interface VaultConfig {
  version: 1;
  vaultId: string;
  name: string;
  createdAt: string;
  residentBudget: number;
  minimumConfidence: number;
  minimumProcedureEvidence: number;
}

export interface Actor {
  id: string;
  name: string;
  email?: string;
}

export interface EvidenceMeta {
  id: string;
  type: 'evidence';
  createdAt: string;
  actor: string;
  sourceUri?: string;
  scope: Scope;
  sensitivity: Sensitivity;
  sha256: string;
  immutable: true;
}

export interface CandidateMeta {
  id: string;
  type: 'memory-candidate';
  createdAt: string;
  updatedAt: string;
  kind: MemoryKind;
  key: string;
  scope: Scope;
  sensitivity: Sensitivity;
  confidence: number;
  explicit: boolean;
  status: CandidateStatus;
  evidence: string[];
  conditions: string[];
  tags: string[];
  expiresAt?: string;
  conflictsWith: string[];
  rejectionReason?: string;
  promotedTo?: string;
}

export interface MemoryMeta {
  id: string;
  type: 'memory';
  createdAt: string;
  updatedAt: string;
  validatedAt: string;
  kind: MemoryKind;
  key: string;
  scope: Scope;
  sensitivity: Sensitivity;
  confidence: number;
  status: MemoryStatus;
  evidence: string[];
  conditions: string[];
  tags: string[];
  expiresAt?: string;
  revision: number;
  supersedes?: string[];
  supersededBy?: string;
  revokedAt?: string;
  revocationReason?: string;
}

export interface MarkdownDocument<T extends object> {
  path: string;
  meta: T;
  body: string;
}

export interface SearchHit {
  path: string;
  id: string;
  title: string;
  kind: string;
  scope?: Scope;
  sensitivity?: Sensitivity;
  score: number;
  snippet: string;
  links: string[];
  backlinks: string[];
}

export interface DoctorReport {
  healthy: boolean;
  counts: {
    evidence: number;
    candidates: number;
    activeMemories: number;
  };
  pendingCandidates: string[];
  conflicts: string[];
  expired: string[];
  deadLinks: Array<{ source: string; target: string }>;
  orphans: string[];
}

export interface ProposedMemory {
  kind: MemoryKind;
  key: string;
  statement: string;
  scope: Scope;
  sensitivity: Sensitivity;
  confidence: number;
  explicit: boolean;
  conditions: string[];
  tags: string[];
  expiresAt?: string;
}
