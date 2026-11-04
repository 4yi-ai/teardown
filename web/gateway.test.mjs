import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway, GatewayError} from './gateway.mjs';

test('sends model and tools to the configured gateway without exposing the token in errors', async () => {
  let request;
  const client = createGateway({baseUrl: 'https://example.test/api/v1/', apiKey: 'test-secret', model: 'test-model',
    fetchImpl: async (url, init) => {
      request = {url, init};
      return new Response(JSON.stringify({choices: [{message: {role: 'assistant', tool_calls: [{id: 'a'}]}}]}));
    }});
  const result = await client.complete({messages: [{role: 'user', content: 'hello'}], tools: [{type: 'function'}]});
  assert.equal(request.url, 'https://example.test/api/v1/chat/completions');
  assert.equal(request.init.headers.authorization, 'Bearer test-secret');
  assert.equal(JSON.parse(request.init.body).model, 'test-model');
  assert.equal(JSON.parse(request.init.body).max_completion_tokens, 8192);
  assert.equal(result.tool_calls[0].id, 'a');
  const fail = createGateway({baseUrl: 'https://example.test/api/v1', apiKey: 'test-secret', model: 'm',
    fetchImpl: async () => new Response('test-secret', {status: 401})});
  await assert.rejects(fail.complete({messages: [{role: 'user', content: 'x'}]}), error =>
    error instanceof GatewayError && error.code === 'gateway_request_failed' && error.status === 401 && !String(error).includes('test-secret'));
});

test('rejects invalid configuration and malformed responses', async () => {
  assert.throws(() => createGateway({baseUrl: 'https://user:pass@example.test', apiKey: 'x', model: 'm'}), /gateway_url_invalid/);
  const client = createGateway({baseUrl: 'https://example.test', apiKey: 'x', model: 'm', fetchImpl: async () => new Response('{}')});
  await assert.rejects(client.complete({messages: [{role: 'user', content: 'x'}]}), /gateway_invalid_response/);
});
