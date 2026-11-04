import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalVisualRenderer} from './visual-client.mjs';

test('local renderer only accepts loopback and submits HTML without credentials', async () => {
  assert.throws(() => createLocalVisualRenderer({url: 'https://example.com/render'}), /visual_url_invalid/);
  const render = createLocalVisualRenderer({url: 'http://127.0.0.1:43117/render', fetchImpl: async (url, options) => {
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(options.headers.authorization, undefined);
    assert.equal(JSON.parse(options.body).html, '<canvas></canvas>');
    return new Response(JSON.stringify({canvasCount: 1, errors: [], image: 'YWJj'}));
  }});
  assert.equal((await render({html: '<canvas></canvas>'})).canvasCount, 1);
});
