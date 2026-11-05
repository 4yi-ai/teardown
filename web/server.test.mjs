import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from './server.mjs';
import {createJobStore} from './jobs.mjs';
import {createRouterIdentityVerifier} from './router-identity.mjs';
import {createHash, createHmac, randomUUID} from 'node:crypto';

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
    const init = {method: 'POST', headers: {...auth, origin: 'https://other.example', 'content-type': 'application/json'}, body: JSON.stringify({description: '汽车模型'})};
    assert.equal((await fetch(`${base}/api/jobs`, init)).status, 403);
    init.headers.origin = 'https://app.example';
    for (const description of ['', '  \n\t\u3000', 'a'.repeat(8001)]) {
      const invalid = await fetch(`${base}/api/jobs`, {...init, body: JSON.stringify({description})});
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error, 'invalid_description');
    }
    const response = await fetch(`${base}/api/jobs`, init); assert.equal(response.status, 202);
    const job = await response.json();
    assert.equal(job.description, '汽车模型');
    assert.equal((await fetch(`${base}/api/jobs/${job.id}`, {headers: {...auth, 'x-xclaw-user-id': 'bob'}})).status, 404);
    let preview;
    for (let i = 0; i < 100; i++) { preview = await fetch(`${base}/api/jobs/${job.id}/preview`, {headers: auth}); if (preview.status === 200) break; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.match(preview.headers.get('content-security-policy'), /connect-src 'none'/);
  } finally { server.close(); await once(server, 'close'); await rm(directory, {recursive: true, force: true}); }
});

test('signed identities isolate lists, detail, preview and cancellation across users and organizations', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-isolation-'));
  const key = 'c'.repeat(64), host = 'app.example';
  const store = createJobStore({directory, generate: async ({signal}) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('cancelled'))); })});
  const server = createApp({store, verifyIdentity:createRouterIdentityVerifier({key, hostname:host})});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (method, url, org, user, body) => {
    const data = body ? JSON.stringify(body) : ''; const time = String(Date.now()); const nonce = randomUUID().replaceAll('-', '');
    const hash = createHash('sha256').update(data).digest('hex');
    const signature = createHmac('sha256',key).update(JSON.stringify(['v1',host,method,url,user,org,time,nonce,hash])).digest('hex');
    return fetch(base+url, {method, headers:{'x-xclaw-owner-org-id':org,'x-xclaw-user-id':user,'x-xclaw-hostname':host,'x-xclaw-identity-time':time,'x-xclaw-identity-nonce':nonce,'x-xclaw-identity-signature':signature, origin:`https://${host}`, 'content-type':'application/json'}, ...(data ? {body:data} : {})});
  };
  try {
    const created = await request('POST','/api/jobs','org-a','alice',{description:'crank'}); assert.equal(created.status,202); const job = await created.json();
    for (const [org,user] of [['org-a','bob'],['org-b','eve']]) {
      const list = await request('GET','/api/jobs',org,user); assert.deepEqual((await list.json()).jobs,[]);
      for (const [method,url] of [['GET',`/api/jobs/${job.id}`],['GET',`/api/jobs/${job.id}/preview`],['POST',`/api/jobs/${job.id}/cancel`]]) assert.equal((await request(method,url,org,user)).status,404);
    }
    assert.equal((await request('POST',`/api/jobs/${job.id}/cancel`,'org-a','alice')).status,202);
  } finally {server.close(); await once(server,'close'); await rm(directory,{recursive:true,force:true});}
});

test('locale preference is read from application SSO cookie and restricted to supported values', async () => {
  const server = createApp({store:{}, verifyIdentity:() => true}); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {'x-xclaw-owner-org-id':'org','x-xclaw-user-id':'user','x-xclaw-hostname':'app.example'};
  try {
    for (const [cookie, expected] of [['__Host-xclaw_app_locale=en','en'],['xclaw_app_locale=zh','zh'],['__Host-xclaw_app_locale=other',null]]) {
      const response = await fetch(`${base}/api/locale`,{headers:{...headers,cookie}}); assert.equal(response.status,200); assert.equal((await response.json()).locale,expected);
    }
  } finally {server.close(); await once(server,'close');}
});
