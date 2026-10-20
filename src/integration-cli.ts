import { AgentMemoryError } from './errors.js';
import { applyClientSetup, previewClientSetup, removeClientSetup, verifyClientSetup, type ClientSetupOptions } from './onboarding.js';

export type IntegrationSetupAction = 'preview' | 'apply' | 'verify' | 'remove';
export async function runIntegrationSetup(action: IntegrationSetupAction, options: ClientSetupOptions & { expectedRevision?: string }): Promise<unknown> {
  if (action === 'preview') return previewClientSetup(options);
  if (action === 'verify') return verifyClientSetup(options);
  if (action === 'remove') return removeClientSetup(options);
  if (action !== 'apply') throw new AgentMemoryError('VALIDATION_FAILED', 'Setup action must be preview, apply, verify, or remove');
  if (!options.expectedRevision) throw new AgentMemoryError('VALIDATION_FAILED', 'Review a setup preview first, then pass its --expected-revision value');
  const plan = await previewClientSetup(options);
  if (plan.expectedRevision !== options.expectedRevision) throw new AgentMemoryError('VALIDATION_FAILED', 'Client configuration changed; create and review a new preview');
  return applyClientSetup(plan);
}
