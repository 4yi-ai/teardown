import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, createHmac} from 'node:crypto';
import {createRouterIdentityVerifier} from './router-identity.mjs';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('accepts a signed router request once and rejects forged, modified, stale and cross-instance requests', () => {
  const master = 'test-master'; const hostname = 'teardown-test.apps.example'; const now = 1790000000000;
  const epoch = '12345678-1234-4123-8123-123456789abc';
  const key = createHmac('sha256', master).update(`4yi-router-identity-v1\0${hostname}\0${epoch}`).digest('hex');
  const h = {'x-xclaw-user-id':'u', 'x-xclaw-owner-org-id':'o', 'x-xclaw-hostname':hostname, 'x-xclaw-identity-time':String(now), 'x-xclaw-identity-nonce':'a'.repeat(32)};
  const req = {method:'POST', url:'/api/jobs', headers:h};
  const bytes = Buffer.from('original body'); const bodyHash = createHash('sha256').update(bytes).digest('hex');
  h['x-xclaw-identity-signature'] = createHmac('sha256', key).update(JSON.stringify(['v1',hostname,req.method,req.url,'u','o',String(now),h['x-xclaw-identity-nonce'],bodyHash])).digest('hex');
  const verify = createRouterIdentityVerifier({key, hostname, now:()=>now});
  assert.equal(verify({...req, headers:{...h, 'x-xclaw-user-id':'attacker'}}), false);
  assert.equal(verify({...req, url:'/api/other'}), false);
  assert.equal(createRouterIdentityVerifier({key,hostname:'other.example',now:()=>now})(req), false);
  assert.equal(createRouterIdentityVerifier({key,hostname,now:()=>now+31000})(req), false);
  assert.equal(verify(req, Buffer.from('modified body')), false);
  assert.equal(verify(req, bytes), true);
  assert.equal(verify(req, bytes), false);
});

test('replay protection survives verifier restart', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'teardown-nonces-'));
  const now = Date.now(); const key = 'a'.repeat(64); const host = 'app.example'; const nonce = 'b'.repeat(32);
  const h = {'x-xclaw-user-id':'u','x-xclaw-owner-org-id':'o','x-xclaw-hostname':host,'x-xclaw-identity-time':String(now),'x-xclaw-identity-nonce':nonce};
  const hash = createHash('sha256').update('').digest('hex');
  h['x-xclaw-identity-signature'] = createHmac('sha256', key).update(JSON.stringify(['v1',host,'GET','/api/jobs','u','o',String(now),nonce,hash])).digest('hex');
  const request = {method:'GET',url:'/api/jobs',headers:h};
  try {
    assert.equal(createRouterIdentityVerifier({key,hostname:host,replayDirectory:dir})(request), true);
    assert.equal(createRouterIdentityVerifier({key,hostname:host,replayDirectory:dir})(request), false);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});
