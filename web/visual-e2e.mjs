// Local-only integration probe: real HTTP app and Docker renderer, mock model.
// Requires the 4yi-teardown-visual:local image and Docker on the host.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const children = [];
const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-e2e-'));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
const port = async () => {const s = http.createServer(); const p = await listen(s); await close(s); return p;};
const start = (file, env) => {const child = spawn(process.execPath, [file], {env: {...process.env, ...env}, stdio: ['ignore', 'ignore', 'pipe']}); child.stderr.on('data', () => {}); children.push(child); return child;};
let visionCalls = 0; let codeCalls = 0;
const gateway = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks));
    let message;
    if (request.messages[0].content.startsWith('Assess a screenshot')) {
      const image = request.messages[1].content[1].image_url.url;
      assert.match(image, /^data:image\/jpeg;base64,/); assert.ok(image.length > 1000); visionCalls++;
      message = {role: 'assistant', content: JSON.stringify({passed: true, feedback: 'Canvas visible.'})};
    } else {
      const actions = [
        ['write_file', {path: 'main.js', content: "const c=document.createElement('canvas'); c.width=300;c.height=200;document.querySelector('#app').appendChild(c);c.getContext('2d').fillRect(0,0,100,100);"}],
        ['build_simulator', {entry: 'main.js'}], ['finish', {}],
      ];
      const [name, args] = actions[codeCalls++];
      message = {role: 'assistant', tool_calls: [{id: `call-${codeCalls}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]};
    }
    res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({choices: [{message}]}));
  } catch {res.writeHead(500); res.end();}
});
try {
  const gatewayPort = await listen(gateway); const visualPort = await port(); const appPort = await port();
  start('web/visual-service.mjs', {TEARDOWN_VISUAL_PORT: String(visualPort)});
  start('web/server.mjs', {TEARDOWN_LOCAL_MODE: '1', PORT: String(appPort), TEARDOWN_DATA_DIR: directory, OPENAI_API_BASE: `http://127.0.0.1:${gatewayPort}/v1`, OPENAI_API_KEY: 'fixture-only', TEXT_MODEL: 'fixture', TEARDOWN_LOCAL_VISUAL_URL: `http://127.0.0.1:${visualPort}/render`});
  const base = `http://127.0.0.1:${appPort}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {try {ready = (await fetch(`${base}/healthz`)).ok; if (ready) break;} catch {} await delay(100);}
  assert.ok(ready, 'app did not start');
  const create = await fetch(`${base}/api/jobs`, {method: 'POST', headers: {'content-type': 'application/json', origin: base}, body: JSON.stringify({description: 'A simple crank mechanism'})});
  assert.equal(create.status, 202); const {id} = await create.json();
  let job;
  for (let i = 0; i < 120; i++) {job = await (await fetch(`${base}/api/jobs/${id}`)).json(); if (['completed', 'failed'].includes(job.status)) break; await delay(250);}
  assert.equal(job.status, 'completed'); assert.equal(visionCalls, 1); assert.equal(codeCalls, 3);
  assert.equal((await fetch(`${base}/api/jobs/${id}/preview`)).status, 200);
  console.log('PASS: HTTP job -> container screenshot -> vision request -> authorized preview (mock model)');
} finally {
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map(child => new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve))));
  await close(gateway); await rm(directory, {recursive: true, force: true});
}
