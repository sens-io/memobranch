import { AgentMemoryError } from './errors.js';
import type { Actor, Scope, Sensitivity } from './types.js';
import { scopes, sensitivities } from './types.js';

export const permissions = ['read', 'write', 'review', 'sync', 'maintain', 'admin'] as const;
export type Permission = (typeof permissions)[number];

export interface Principal extends Actor {
  permissions: Permission[];
  scopes: Scope[];
  maxSensitivity: Sensitivity;
  tenantId?: string;
}

const sensitivityRank: Record<Sensitivity, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  secret: 3,
};

export function localAdminPrincipal(actor: Actor = { id: 'human', name: 'Local operator' }): Principal {
  return {
    ...actor,
    permissions: [...permissions],
    scopes: [...scopes],
    maxSensitivity: 'secret',
  };
}

export function principalFromEnv(env: NodeJS.ProcessEnv = process.env): Principal {
  const configuredPermissions = csv(env.AMEM_PERMISSIONS, ['read']);
  const configuredScopes = csv(env.AMEM_ALLOWED_SCOPES, [...scopes]);
  const maxSensitivity = env.AMEM_MAX_SENSITIVITY ?? 'internal';
  if (!isOneOf(maxSensitivity, sensitivities)) {
    throw new AgentMemoryError('CONFIG_INVALID', 'AMEM_MAX_SENSITIVITY is invalid');
  }
  const invalidPermission = configuredPermissions.find((value) => !isOneOf(value, permissions));
  if (invalidPermission) throw new AgentMemoryError('CONFIG_INVALID', `Unknown permission: ${invalidPermission}`);
  const invalidScope = configuredScopes.find((value) => !isOneOf(value, scopes));
  if (invalidScope) throw new AgentMemoryError('CONFIG_INVALID', `Unknown scope: ${invalidScope}`);
  const id = env.AMEM_ACTOR_ID?.trim() || 'agent';
  const name = env.AMEM_ACTOR_NAME?.trim() || id;
  const email = env.AMEM_ACTOR_EMAIL?.trim();
  const tenantId = env.AMEM_TENANT_ID?.trim();
  return {
    id,
    name,
    ...(email ? { email } : {}),
    permissions: configuredPermissions as Permission[],
    scopes: configuredScopes as Scope[],
    maxSensitivity,
    ...(tenantId ? { tenantId } : {}),
  };
}

export function authorize(
  principal: Principal,
  permission: Permission,
  resource?: { scope?: Scope; sensitivity?: Sensitivity; tenantId?: string },
): void {
  if (!principal.permissions.includes(permission) && !principal.permissions.includes('admin')) {
    deny(principal, permission, 'permission');
  }
  if (resource?.scope && !principal.scopes.includes(resource.scope)) {
    deny(principal, permission, 'scope');
  }
  if (resource?.sensitivity && sensitivityRank[resource.sensitivity] > sensitivityRank[principal.maxSensitivity]) {
    deny(principal, permission, 'sensitivity');
  }
  if (principal.tenantId && resource?.tenantId && principal.tenantId !== resource.tenantId) {
    deny(principal, permission, 'tenant');
  }
}

export function canAccess(principal: Principal, scope: Scope, sensitivity: Sensitivity): boolean {
  try {
    authorize(principal, 'read', { scope, sensitivity });
    return true;
  } catch {
    return false;
  }
}

export function assertTenant(principal: Principal, tenantId: string): void {
  if (principal.tenantId && principal.tenantId !== tenantId) deny(principal, 'read', 'tenant');
}

function deny(principal: Principal, permission: Permission, reason: string): never {
  throw new AgentMemoryError('AUTHORIZATION_DENIED', 'The principal is not authorized for this operation', {
    principalId: principal.id,
    permission,
    reason,
  });
}

function csv(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) return fallback;
  return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.includes(value as T);
}
