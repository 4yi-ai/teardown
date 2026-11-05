import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {isValidDescription} from './description.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const publicJob = ({id, description, status, createdAt, updatedAt, error}) => ({id, description, status, createdAt, updatedAt, ...(error ? {error} : {})});

/** Disk-backed jobs. A process owns a single store; scopes are never supplied as paths. */
export function createJobStore({directory, generate, now = () => new Date().toISOString(), maxActive = 3}) {
  const active = new Map();
  const scopeDir = scope => path.join(directory, createHash('sha256').update(JSON.stringify([scope.org, scope.user])).digest('hex'));
  const jobDir = (scope, id) => {
    if (!UUID.test(id)) throw new Error('job_not_found');
    return path.join(scopeDir(scope), id);
  };
  async function save(dir, job) {
    const temporary = path.join(dir, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(job), {mode: 0o600});
    await rename(temporary, path.join(dir, 'job.json'));
  }
  async function get(scope, id) {
    try {
      const dir = jobDir(scope, id);
      let job = JSON.parse(await readFile(path.join(dir, 'job.json'), 'utf8'));
      if (['queued', 'generating'].includes(job.status) && active.get(scopeDir(scope))?.id !== id) {
        // A concurrent completion may have replaced the file after the first
        // read but before its in-memory lease was released. Re-read before
        // classifying the run as interrupted.
        job = JSON.parse(await readFile(path.join(dir, 'job.json'), 'utf8'));
        if (['queued', 'generating'].includes(job.status) && active.get(scopeDir(scope))?.id !== id) {
          job.status = 'failed'; job.error = 'interrupted'; job.updatedAt = now(); await save(dir, job);
        }
      }
      return job;
    }
    catch { throw new Error('job_not_found'); }
  }
  async function list(scope) {
    let ids;
    try { ids = await readdir(scopeDir(scope)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const items = await Promise.all(ids.filter(id => UUID.test(id)).map(id => get(scope, id).catch(() => null)));
    return items.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicJob);
  }
  async function create(scope, description, locale = 'zh') {
    if (!isValidDescription(description)) throw new Error('invalid_description');
    const scopeKey = scopeDir(scope);
    if (active.has(scopeKey)) throw new Error('job_already_running');
    if (active.size >= maxActive) throw new Error('job_capacity_reached');
    const controller = new AbortController();
    active.set(scopeKey, {id: null, controller});
    const id = randomUUID();
    active.get(scopeKey).id = id;
    const dir = jobDir(scope, id);
    const job = {id, locale, description: description.trim(), status: 'queued', createdAt: now(), updatedAt: now()};
    try { await mkdir(dir, {recursive: true, mode: 0o700}); await save(dir, job); }
    catch (error) { active.delete(scopeKey); throw error; }
    const run = async () => {
      try {
        job.status = 'generating'; job.updatedAt = now(); await save(dir, job);
        if (controller.signal.aborted) throw new Error('cancelled');
        const result = await generate({description: job.description, locale: job.locale, signal: controller.signal});
        if (controller.signal.aborted) throw new Error('cancelled');
        await writeFile(path.join(dir, 'simulator.html'), result.html, {mode: 0o600});
        job.status = 'completed';
      } catch (error) {
        job.status = controller.signal.aborted ? 'cancelled' : 'failed';
        if (!controller.signal.aborted) console.error('generation failed:', typeof error?.code === 'string' ? error.code : typeof error?.message === 'string' && /^[a-z_]+$/.test(error.message) ? error.message : 'unknown', 'status:', Number.isInteger(error?.status) ? error.status : 'none');
        if (!controller.signal.aborted) job.error = error?.status === 402 ? 'balance_required' : 'generation_failed';
      } finally {
        job.updatedAt = now(); await save(dir, job).catch(() => {}); active.delete(scopeKey);
      }
    };
    void run();
    return publicJob(job);
  }
  async function artifact(scope, id) {
    const job = await get(scope, id);
    if (job.status !== 'completed') throw new Error('job_not_ready');
    return readFile(path.join(jobDir(scope, id), 'simulator.html'), 'utf8');
  }
  async function cancel(scope, id) {
    const job = await get(scope, id);
    const execution = active.get(scopeDir(scope));
    if (!execution || execution.id !== id || !['queued', 'generating'].includes(job.status)) throw new Error('job_not_running');
    execution.controller.abort();
    return {id, cancellationRequested: true};
  }
  return {create, list, get: async (scope, id) => publicJob(await get(scope, id)), artifact, cancel};
}
