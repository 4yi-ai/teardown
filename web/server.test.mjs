import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from './server.mjs';
import {createJobStore} from './jobs.mjs';

test('HTTP jobs require identity and same origin, and preview enforces sandbox CSP', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-http-'));
  const store = createJobStore({directory, generate: async () => ({html: '<script>1</script>'})});
  const server = createApp({store}); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = {'x-xclaw-owner-org-id': 'org', 'x-xclaw-user-id': 'alice', 'x-xclaw-hostname': 'app.example'};
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/api/jobs`)).status, 401);
    const init = {method: 'POST', headers: {...auth, origin: 'https://other.example', 'content-type': 'application/json'}, body: JSON.stringify({description: 'A rotating crank'})};
    assert.equal((await fetch(`${base}/api/jobs`, init)).status, 403);
    init.headers.origin = 'https://app.example';
    const response = await fetch(`${base}/api/jobs`, init); assert.equal(response.status, 202);
    const job = await response.json();
    assert.equal((await fetch(`${base}/api/jobs/${job.id}`, {headers: {...auth, 'x-xclaw-user-id': 'bob'}})).status, 404);
    let preview;
    for (let i = 0; i < 100; i++) { preview = await fetch(`${base}/api/jobs/${job.id}/preview`, {headers: auth}); if (preview.status === 200) break; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.match(preview.headers.get('content-security-policy'), /connect-src 'none'/);
  } finally { server.close(); await once(server, 'close'); await rm(directory, {recursive: true, force: true}); }
});
