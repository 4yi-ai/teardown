import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createJobStore} from './jobs.mjs';

test('jobs and artifacts are scoped to the requesting user and organization', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-jobs-'));
  try {
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    const store = createJobStore({directory, generate: async () => { await gate; return {html: '<p>result</p>'}; }});
    const owner = {org: 'one', user: 'alice'};
    const job = await store.create(owner, 'Show a crank mechanism');
    await assert.rejects(store.create(owner, 'A second mechanism'), /job_already_running/);
    await assert.rejects(store.get({org: 'one', user: 'bob'}, job.id), /job_not_found/);
    await assert.rejects(store.get({org: 'two', user: 'alice'}, job.id), /job_not_found/);
    await assert.rejects(store.artifact(owner, job.id), /job_not_ready/);
    finish();
    for (let i = 0; i < 100 && (await store.get(owner, job.id)).status !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(await store.artifact(owner, job.id), '<p>result</p>');
    assert.equal((await store.list(owner)).length, 1);
    assert.deepEqual(await store.list({org: 'two', user: 'alice'}), []);
    await assert.rejects(store.get(owner, '../secret'), /job_not_found/);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('cancellation is scoped and aborts the active generator', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-cancel-'));
  try {
    const store = createJobStore({directory, generate: ({signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true}))});
    const scope = {org: 'one', user: 'alice'};
    const job = await store.create(scope, 'Show a crank mechanism');
    await assert.rejects(store.cancel({org: 'one', user: 'bob'}, job.id), /job_not_found/);
    await store.cancel(scope, job.id);
    for (let i = 0; i < 100 && (await store.get(scope, job.id)).status !== 'cancelled'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await store.get(scope, job.id)).status, 'cancelled');
  } finally { await rm(directory, {recursive: true, force: true}); }
});
