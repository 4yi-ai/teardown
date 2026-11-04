import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGateway} from './gateway.mjs';
import {generateSimulator} from './generator.mjs';
import {createJobStore} from './jobs.mjs';
import {createVisualReviewer} from './visual-review.mjs';
import {createLocalVisualRenderer} from './visual-client.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const mime = {'.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml'};
const previewCsp = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
function json(res, status, value) { res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}); res.end(JSON.stringify(value)); }
async function body(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new Error('invalid_content_type');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new Error('body_too_large'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('invalid_json'); }
}
function scopeFor(req, local) {
  if (local) return {org: 'local', user: 'local'};
  const org = req.headers['x-xclaw-owner-org-id']; const user = req.headers['x-xclaw-user-id'];
  if (typeof org !== 'string' || typeof user !== 'string' || !org || !user) return null;
  return {org, user};
}
function sameOrigin(req, local) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const expected = local ? req.headers.host : req.headers['x-xclaw-hostname'];
    return new URL(origin).host === expected;
  } catch { return false; }
}
export function createApp({store, local = false, dist = path.join(root, 'web-dist')}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, {ok: true});
    const scope = scopeFor(req, local);
    if (!scope) return json(res, 401, {error: 'authentication_required'});
    try {
      if (url.pathname === '/api/jobs' && req.method === 'GET') return json(res, 200, {jobs: await store.list(scope)});
      if (url.pathname === '/api/jobs' && req.method === 'POST') {
        if (!sameOrigin(req, local)) return json(res, 403, {error: 'origin_invalid'});
        const value = await body(req);
        return json(res, 202, await store.create(scope, value.description));
      }
      const cancelMatch = /^\/api\/jobs\/([0-9a-f-]+)\/cancel$/.exec(url.pathname);
      if (req.method === 'POST' && cancelMatch) {
        if (!sameOrigin(req, local)) return json(res, 403, {error: 'origin_invalid'});
        return json(res, 202, await store.cancel(scope, cancelMatch[1]));
      }
      const match = /^\/api\/jobs\/([0-9a-f-]+)(\/preview)?$/.exec(url.pathname);
      if (req.method === 'GET' && match) {
        if (!match[2]) return json(res, 200, await store.get(scope, match[1]));
        const html = await store.artifact(scope, match[1]);
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': previewCsp, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'}); return res.end(html);
      }
      if (req.method !== 'GET') return json(res, 404, {error: 'not_found'});
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!/^(?:index\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(name)) return json(res, 404, {error: 'not_found'});
      const content = await readFile(path.join(dist, name));
      res.writeHead(200, {'content-type': mime[path.extname(name)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store'}); return res.end(content);
    } catch (error) {
      const code = error?.message;
      const status = code === 'job_not_found' || error?.code === 'ENOENT' ? 404 : ['job_already_running', 'job_capacity_reached', 'job_not_ready', 'job_not_running'].includes(code) ? 409 : ['invalid_description', 'invalid_content_type', 'invalid_json', 'body_too_large'].includes(code) ? 400 : 500;
      return json(res, status, {error: status === 500 ? 'internal_error' : code});
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const local = process.env.TEARDOWN_LOCAL_MODE === '1';
  // Identity headers are trustworthy only when direct pod access is blocked
  // and the 4yi router is the sole ingress. This flag is a deployment gate,
  // not proof that the network boundary exists.
  if (!local && process.env.TEARDOWN_TRUSTED_PROXY !== '1') throw new Error('trusted_proxy_boundary_not_confirmed');
  const gateway = createGateway({baseUrl: process.env.OPENAI_API_BASE || process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY, model: process.env.TEXT_MODEL, reasoningEffort: process.env.TEARDOWN_REASONING_EFFORT || (process.env.TEXT_MODEL === 'gpt-6-luna' ? 'none' : undefined)});
  const visualUrl = process.env.TEARDOWN_LOCAL_VISUAL_URL;
  if (visualUrl && !local) throw new Error('local_visual_renderer_requires_local_mode');
  const visualGateway = visualUrl ? createGateway({baseUrl: process.env.OPENAI_API_BASE || process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY, model: process.env.TEARDOWN_VISION_MODEL || process.env.TEXT_MODEL}) : null;
  const visualReview = visualUrl ? createVisualReviewer({render: createLocalVisualRenderer({url: visualUrl}), gateway: visualGateway}) : undefined;
  const store = createJobStore({directory: process.env.TEARDOWN_DATA_DIR || path.join(root, 'teardown-out', 'jobs'), generate: ({description, signal}) => generateSimulator({gateway, description, signal, visualReview})});
  createApp({store, local}).listen(Number(process.env.PORT || 3000), local ? '127.0.0.1' : '0.0.0.0');
}
