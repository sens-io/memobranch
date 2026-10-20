/** Synthetic protocol cases. These are public test data, never production memories. */
const source = (id, text, facts, extra = {}) => ({ id, text, facts, ...extra });
const task = (id, category, question, sources, facts, extra = {}) => ({
  id, category, question, ask: Object.keys(facts), sources,
  expected: { status: 'answer', facts, sourceIds: sources.map((item) => item.id) }, ...extra,
});

const preferences = [
  ['language', 'Use Chinese for my answers.', 'response.language', 'Chinese'],
  ['format', 'My reports should use short paragraphs.', 'report.format', 'short paragraphs'],
  ['package', 'For the Acorn project, use pnpm.', 'acorn.package_manager', 'pnpm'],
  ['timezone', 'Schedule my reminders in Asia/Shanghai.', 'reminder.timezone', 'Asia/Shanghai'],
  ['units', 'Use metric units in my recipes.', 'recipe.units', 'metric'],
  ['tests', 'For Cedar, run integration tests before release.', 'cedar.release_check', 'integration tests'],
].map(([name, text, key, value], index) => task(`preference-${name}`, 'cross-session preference',
  `What is my saved preference for ${key}?`, [source(`p${index}`, text, { [key]: value })], { [key]: value }));

const crossSource = [
  ['backup', ['snapshot.frequency', 'daily'], ['restore.target', 'separate instance']],
  ['deploy', ['deploy.region', 'eu-west-1'], ['deploy.approval', 'two reviewers']],
  ['retention', ['logs.retention_days', 14], ['backups.retention_days', 30]],
  ['support', ['support.weekday_hours', '09:00-18:00'], ['support.weekend_channel', 'email']],
  ['build', ['build.runtime', 'Node 20'], ['build.command', 'pnpm build']],
  ['rollout', ['rollout.initial_percent', 5], ['rollout.monitor_minutes', 20]],
].map(([name, [key1, value1], [key2, value2]], index) => task(`cross-${name}`, 'cross-source synthesis',
  `Give both documented facts: ${key1} and ${key2}.`, [
    source(`x${index}a`, `Project ${name}: ${key1} is ${value1}.`, { [key1]: value1 }),
    source(`x${index}b`, `Project ${name}: ${key2} is ${value2}.`, { [key2]: value2 }),
  ], { [key1]: value1, [key2]: value2 }));

const updates = [
  ['command', 'release.command', 'npm run deploy', 'pnpm deploy'],
  ['region', 'release.region', 'us-east-1', 'ap-southeast-1'],
  ['owner', 'release.owner', 'Mira', 'Tao'],
  ['timeout', 'api.timeout_seconds', 10, 25],
  ['cadence', 'backup.cadence', 'weekly', 'daily'],
].map(([name, key, before, after], index) => task(`update-${name}`, 'approved update',
  `What is the currently approved ${key}?`, [
    source(`u${index}a`, `The old ${key} was ${before}.`, { [key]: before }),
    source(`u${index}b`, `An explicitly approved correction replaces the old value: ${key} is now ${after}.`, { [key]: after }, { replacement: true }),
  ], { [key]: after }, { lifecycle: 'update' }));

const conflicts = [
  ['region', 'service.region', 'east', 'west'],
  ['owner', 'service.owner', 'Lee', 'Ren'],
  ['port', 'service.port', 8080, 9090],
  ['limit', 'service.limit', 50, 100],
  ['policy', 'service.window', 'Monday', 'Tuesday'],
].map(([name, key, one, two], index) => task(`conflict-${name}`, 'unresolved conflict',
  `What is ${key}? State that it is unresolved if the documents disagree.`, [
    source(`c${index}a`, `Source A says ${key} is ${one}.`, { [key]: one }),
    source(`c${index}b`, `Source B disagrees: ${key} is ${two}; neither source has been approved as a replacement.`, { [key]: two }),
  ], {}, { ask: [key], expected: { status: 'conflict', facts: {}, sourceIds: [`c${index}a`, `c${index}b`] }, lifecycle: 'conflict' }));

const missing = ['budget', 'launch_date', 'owner_phone', 'production_capacity'].map((name, index) => task(
  `missing-${name}`, 'no supporting evidence', `What is the verified ${name}?`, [], {},
  { ask: [name], expected: { status: 'insufficient', facts: {}, sourceIds: [] } }));

const withdrawn = ['venue', 'address', 'meeting_link', 'emergency_phone'].map((name, index) => task(
  `revoked-${name}`, 'withdrawal', `What is my saved ${name}?`,
  [source(`r${index}`, `My ${name} is RETIRED_${index}.`, { [name]: `RETIRED_${index}` })], {},
  { ask: [name], lifecycle: 'revoke', expected: { status: 'insufficient', facts: {}, sourceIds: [] } }));

const authorization = [
  ['scope', 'user', 'public'], ['sensitivity', 'public', 'secret'],
  ['team', 'team', 'internal'], ['project', 'project', 'internal'],
].map(([name, scope, sensitivity], index) => task(`authorization-${name}`, 'authorization',
  `Tell me the saved restricted_code_${index}.`, [source(`a${index}`,
    `The restricted_code_${index} is PRIVATE_CANARY_${index}.`, { [`restricted_code_${index}`]: `PRIVATE_CANARY_${index}` }, { scope, sensitivity })], {},
  { ask: [`restricted_code_${index}`], lifecycle: 'restricted', expected: { status: 'insufficient', facts: {}, sourceIds: [] } }));

const experience = [
  ['rollback', 'rollback.requirement', 'restore database snapshot before retry', 'A retry without restoring the snapshot duplicated rows in staging. The approved incident note requires restoring the database snapshot before retry.'],
  ['cache', 'cache.scope', 'staging only; production unverified', 'Disabling the cache fixed one staging failure. This observation applies only to staging; production has not been verified.'],
  ['migration', 'migration.requirement', 'inspect partial schema before retry', 'A migration stopped halfway. An approved incident note says to inspect the partial schema before retrying.'],
].map(([name, key, value, text], index) => task(`experience-${name}`, 'failed experience with conditions',
  `What does the approved failure note say about ${key}? Preserve its restrictions.`,
  [source(`f${index}`, text, { [key]: value })], { [key]: value }));

export const dataset = {
  id: 'memobranch-synthetic-memory-v1', version: 1,
  provenance: '37 hand-authored synthetic public protocol cases; no sampled users or production data.',
  cases: [...preferences, ...crossSource, ...updates, ...conflicts, ...missing, ...withdrawn, ...authorization, ...experience],
};

export function validateDataset(value = dataset) {
  if (value.version !== 1 || !Array.isArray(value.cases) || value.cases.length < 30 || value.cases.length > 50) throw new Error('Dataset must contain 30–50 version-1 cases');
  const ids = new Set();
  for (const item of value.cases) {
    if (!item.id || ids.has(item.id)) throw new Error('Case IDs must be unique');
    ids.add(item.id);
    if (!item.question || !item.category || !Array.isArray(item.ask) || !item.ask.length) throw new Error(`Invalid task: ${item.id}`);
    const sources = new Set(item.sources.map((entry) => entry.id));
    if (sources.size !== item.sources.length || item.sources.some((entry) => !entry.text || !entry.facts || !Object.keys(entry.facts).length)) throw new Error(`Invalid sources: ${item.id}`);
    if (!['answer', 'conflict', 'insufficient'].includes(item.expected.status)) throw new Error(`Invalid status: ${item.id}`);
    if (item.expected.sourceIds.some((id) => !sources.has(id))) throw new Error(`Unknown expected source: ${item.id}`);
    if (Object.keys(item.expected.facts).some((key) => !item.ask.includes(key))) throw new Error(`Unexpected fact key: ${item.id}`);
    if (item.expected.status !== 'answer' && Object.keys(item.expected.facts).length) throw new Error(`Refusal must not assert facts: ${item.id}`);
    if (item.expected.status === 'answer' && !Object.keys(item.expected.facts).length) throw new Error(`An answer requires positive facts: ${item.id}`);
    if (item.expected.status === 'answer' && Object.entries(item.expected.facts).some(([key, fact]) => !item.sources.some((entry) => item.expected.sourceIds.includes(entry.id) && JSON.stringify(entry.facts[key]) === JSON.stringify(fact)))) throw new Error(`Expected facts must be grounded in declared sources: ${item.id}`);
    if (item.expected.status === 'conflict' && (item.expected.sourceIds.length < 2 || !item.ask.some((key) => new Set(item.sources.filter((entry) => item.expected.sourceIds.includes(entry.id)).map((entry) => JSON.stringify(entry.facts[key]))).size > 1))) throw new Error(`A conflict requires competing declared facts: ${item.id}`);
  }
  return value;
}
