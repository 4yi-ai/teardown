import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {closeSync, fsyncSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync} from 'node:fs';
import path from 'node:path';

export function createRouterIdentityVerifier({key, hostname, replayDirectory, now = Date.now}) {
  if (!/^[a-f0-9]{64}$/.test(key || '') || !hostname) throw new Error('router_identity_configuration_missing');
  const seen = new Map();
  if (replayDirectory) mkdirSync(replayDirectory, {recursive: true, mode: 0o700});
  let lastPrune = 0;
  const expectedHost = hostname.toLowerCase();
  return (req, body = Buffer.alloc(0)) => {
    const h = req.headers;
    const time = h['x-xclaw-identity-time']; const nonce = h['x-xclaw-identity-nonce'];
    const sig = h['x-xclaw-identity-signature']; const user = h['x-xclaw-user-id'];
    const org = h['x-xclaw-owner-org-id']; const host = h['x-xclaw-hostname'];
    if (![time, nonce, sig, user, org, host].every(v => typeof v === 'string' && v.length > 0)) return false;
    if (!/^\d{13}$/.test(time) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(sig) || host.toLowerCase() !== expectedHost) return false;
    const clock = now();
    if (Math.abs(clock - Number(time)) > 30000 || seen.has(nonce)) return false;
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const payload = JSON.stringify(['v1', expectedHost, req.method, req.url, user, org, time, nonce, bodyHash]);
    const actual = createHmac('sha256', key).update(payload).digest();
    if (!timingSafeEqual(actual, Buffer.from(sig, 'hex'))) return false;
    for (const [id, expiry] of seen) if (expiry < clock) seen.delete(id);
    if (seen.size >= 20000) return false;
    if (replayDirectory) {
      // Persist before accepting the request so a restart does not make a
      // recently signed request usable again. Only verified nonces reach disk.
      if (clock - lastPrune > 60000) {
        lastPrune = clock;
        try {
          for (const name of readdirSync(replayDirectory)) {
            if (!/^[a-f0-9]{32}$/.test(name)) continue;
            const file = path.join(replayDirectory, name);
            try { if (statSync(file).mtimeMs < clock - 65000) unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
        } catch { return false; }
      }
      let fd;
      try {
        fd = openSync(path.join(replayDirectory, nonce), 'wx', 0o600); fsyncSync(fd);
        const directoryFd = openSync(replayDirectory, 'r');
        try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
      }
      catch { return false; }
      finally { if (fd !== undefined) closeSync(fd); }
    }
    seen.set(nonce, clock + 60000);
    return true;
  };
}
