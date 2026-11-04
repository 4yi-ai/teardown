import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from './workspace.mjs';

test('builds a multi-file project without reading local server files', async () => {
  const ws = createWorkspace();
  ws.write('main.js', "import {value} from './parts/crank.js'; import {Scene} from 'three'; window.result = [value, new Scene()];");
  ws.write('parts/crank.js', 'export const value = 42;');
  await ws.compile(); assert.match(ws.artifact(), /42/);
  assert.throws(() => ws.write('../secret.js', 'x'), /invalid_path/);
  ws.write('main.js', "import x from '../paths.mjs';");
  assert.throws(() => ws.artifact(), /build_required/);
  await assert.rejects(ws.compile());
  ws.write('main.js', "import x from 'node:fs';"); await assert.rejects(ws.compile());
});
