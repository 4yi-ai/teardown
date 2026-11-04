// Experimental local-only supervisor. Do not run this service in the web container.
import http from 'node:http';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';

const run = promisify(execFile);
const image = process.env.TEARDOWN_VISUAL_IMAGE || '4yi-teardown-visual:local';
if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,240}$/.test(image)) throw new Error('invalid_image');
let busy = false;

async function render(html) {
  const name = `teardown-visual-${randomUUID()}`;
  try {
    const {stdout} = await run('docker', ['create', '--name', name, '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '192', '--memory', '1g', '--cpus', '1', '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m', '--shm-size', '256m', image], {timeout: 15000, maxBuffer: 1024});
    const id = stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('container_create_failed');
    return await new Promise((resolve, reject) => {
      const child = spawn('docker', ['start', '-ai', id], {stdio: ['pipe', 'pipe', 'ignore']});
      let output = ''; let failure;
      const timer = setTimeout(() => {failure = new Error('render_timeout'); child.kill('SIGKILL');}, 30000);
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 4_000_000) {failure = new Error('render_output_too_large'); child.kill('SIGKILL');} });
      child.on('error', error => {clearTimeout(timer); reject(error);});
      child.on('close', code => {clearTimeout(timer); if (failure || code !== 0) return reject(failure || new Error('render_failed')); try {resolve(JSON.parse(output));} catch {reject(new Error('render_invalid'));}});
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({html}));
    });
  } finally {
    await run('docker', ['rm', '-f', name], {timeout: 15000, maxBuffer: 1024}).catch(() => {});
  }
}

http.createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST' || req.url !== '/render' || req.headers['origin'] || req.headers['content-type'] !== 'application/json' || busy) {res.writeHead(busy ? 429 : 400); return res.end();}
  busy = true;
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) {size += chunk.length; if (size > 2_500_000) throw new Error('input_too_large'); chunks.push(chunk);}
    const {html} = JSON.parse(Buffer.concat(chunks).toString());
    if (typeof html !== 'string' || !html || Buffer.byteLength(html) > 2_000_000) throw new Error('invalid_html');
    const result = await render(html);
    res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(result));
  } catch {if (!res.headersSent) res.writeHead(500); res.end();}
  finally {busy = false;}
}).listen(Number(process.env.TEARDOWN_VISUAL_PORT || 43117), '127.0.0.1');
