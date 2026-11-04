import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from './server.mjs';
import {createJobStore} from './jobs.mjs';
import {createRouterIdentityVerifier} from './router-identity.mjs';
import {createHash, createHmac} from 'node:crypto';

test('non-local HTTP requests require a valid, non-replayed router signature', async () => {
  const key = 'a'.repeat(64); const host = 'app.example';
  const verifyIdentity = createRouterIdentityVerifier({key, hostname: host});
  const server = createApp({store: {list: async () => []}, verifyIdentity});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const time = String(Date.now()); const nonce = 'b'.repeat(32);
  const headers = {'x-xclaw-user-id':'alice','x-xclaw-owner-org-id':'org','x-xclaw-hostname':host,'x-xclaw-identity-time':time,'x-xclaw-identity-nonce':nonce};
  const hash = createHash('sha256').update('').digest('hex');
  headers['x-xclaw-identity-signature'] = createHmac('sha256',key).update(JSON.stringify(['v1',host,'GET','/api/jobs','alice','org',time,nonce,hash])).digest('hex');
  try {
    assert.equal((await fetch(`${base}/api/jobs`, {headers:{...headers, 'x-xclaw-user-id':'mallory'}})).status, 401);
    assert.equal((await fetch(`${base}/api/jobs`, {headers})).status, 200);
    assert.equal((await fetch(`${base}/api/jobs`, {headers})).status, 401);
  } finally { server.close(); await once(server, 'close'); }
});

test('HTTP jobs require identity and same origin, and preview enforces sandbox CSP', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-http-'));
  const store = createJobStore({directory, generate: async () => ({html: '<script>1</script>'})});
  const server = createApp({store, verifyIdentity: () => true}); server.listen(0, '127.0.0.1'); await once(server, 'listening');
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
