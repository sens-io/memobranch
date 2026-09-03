import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, test } from 'node:test';
import { AgentMemoryError } from '../src/errors.js';
import { LlmClient } from '../src/llm.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

test('OpenAI-compatible chat and embedding success paths validate bounded output', async () => {
  const baseUrl = await listen((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/embeddings') {
      response.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] }));
      return;
    }
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ memories: [{
      kind: 'fact', key: 'provider', statement: 'provider result', scope: 'public', sensitivity: 'public',
      confidence: 0.9, explicit: true, conditions: ['bounded'], tags: ['provider'],
    }] }) } }] }));
  });
  const client = new LlmClient({ baseUrl, apiKey: 'test', model: 'chat', embeddingModel: 'embed', maxRetries: 0 });
  assert.deepEqual(await client.embed(['hello']), [[1, 0, 0]]);
  const [proposal] = await client.extractMemories('secret source', { scope: 'team', sensitivity: 'secret' });
  assert.equal(proposal?.scope, 'team');
  assert.equal(proposal?.sensitivity, 'secret');
});

test('provider calls enforce retry, timeout, cancellation, and response-size bounds', async () => {
  let retries = 0;
  const retryUrl = await listen((_request, response) => {
    retries += 1;
    response.setHeader('content-type', 'application/json');
    if (retries === 1) {
      response.statusCode = 503;
      response.end('{}');
      return;
    }
    response.end(JSON.stringify({ data: [{ index: 0, embedding: [0, 1] }] }));
  });
  const retrying = new LlmClient({ baseUrl: retryUrl, apiKey: 'test', embeddingModel: 'embed', maxRetries: 1 });
  assert.deepEqual(await retrying.embed(['retry']), [[0, 1]]);
  assert.equal(retries, 2);

  const slowUrl = await listen((_request, response) => {
    setTimeout(() => response.end('{"choices":[]}'), 1_000).unref();
  });
  const timeout = new LlmClient({ baseUrl: slowUrl, apiKey: 'test', model: 'chat', requestTimeoutMs: 100, maxRetries: 0 });
  await assert.rejects(timeout.answer('q', 'context'), dependencyUnavailable);

  const cancelUrl = await listen((_request, response) => {
    setTimeout(() => response.end('{"choices":[]}'), 1_000).unref();
  });
  const cancelled = new LlmClient({ baseUrl: cancelUrl, apiKey: 'test', model: 'chat', requestTimeoutMs: 5_000, maxRetries: 0 });
  const pending = cancelled.answer('q', 'context');
  setTimeout(() => cancelled.cancelPending(), 25).unref();
  await assert.rejects(pending, dependencyUnavailable);

  const largeUrl = await listen((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(2_000) } }] }));
  });
  const bounded = new LlmClient({ baseUrl: largeUrl, apiKey: 'test', model: 'chat', maxResponseBytes: 1_024, maxRetries: 0 });
  await assert.rejects(bounded.answer('q', 'context'), dependencyUnavailable);
});

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a port');
  return `http://127.0.0.1:${address.port}`;
}

function dependencyUnavailable(error: unknown): boolean {
  return error instanceof AgentMemoryError && error.code === 'DEPENDENCY_UNAVAILABLE';
}
