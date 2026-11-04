import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const three = fileURLToPath(import.meta.resolve('three'));
const threeRoot = path.dirname(path.dirname(three));
const MAX_FILE = 100_000;
const MAX_TOTAL = 350_000;
const MAX_FILES = 24;

function filename(value) {
  if (typeof value !== 'string' || value.length > 120 || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(?:js|json)$/.test(value)) throw new Error('invalid_path');
  return value;
}

/** A bounded virtual project; generated source never touches server paths. */
export function createWorkspace() {
  const files = new Map();
  let lastBuild = null;
  function write(name, content) {
    name = filename(name);
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE) throw new Error('invalid_file');
    if (!files.has(name) && files.size >= MAX_FILES) throw new Error('too_many_files');
    const current = [...files.values()].reduce((n, value) => n + Buffer.byteLength(value), 0) - Buffer.byteLength(files.get(name) || '');
    if (current + Buffer.byteLength(content) > MAX_TOTAL) throw new Error('workspace_too_large');
    files.set(name, content); lastBuild = null;
    return {path: name, bytes: Buffer.byteLength(content)};
  }
  function read(name) {
    name = filename(name);
    if (!files.has(name)) throw new Error('file_not_found');
    return files.get(name);
  }
  async function compile(entry = 'main.js') {
    entry = filename(entry);
    if (!files.has(entry)) throw new Error('file_not_found');
    const output = await build({entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent', minify: true,
      plugins: [{name: 'virtual-project', setup(api) {
        api.onResolve({filter: /.*/}, args => {
          if (args.kind === 'entry-point') return {path: entry, namespace: 'project'};
          if (args.namespace === 'project') {
            if (args.path === 'three') return {path: three};
            if (!args.path.startsWith('./') && !args.path.startsWith('../')) return {errors: [{text: 'Only relative project files and three are allowed'}]};
            const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
            if (resolved.startsWith('../') || !files.has(resolved)) return {errors: [{text: `Project import not found: ${args.path}`}]};
            return {path: resolved, namespace: 'project'};
          }
          if (args.importer.startsWith(`${threeRoot}${path.sep}`) && args.path.startsWith('.')) {
            const resolved = path.resolve(path.dirname(args.importer), args.path);
            if (resolved.startsWith(`${threeRoot}${path.sep}`)) return {path: resolved};
          }
          return {errors: [{text: 'Import is not allowed'}]};
        });
        api.onLoad({filter: /.*/, namespace: 'project'}, args => ({contents: files.get(args.path), loader: args.path.endsWith('.json') ? 'json' : 'js'}));
      }}],
    });
    lastBuild = output.outputFiles[0].text;
    return {bytes: Buffer.byteLength(lastBuild)};
  }
  function artifact() { if (!lastBuild) throw new Error('build_required'); return lastBuild; }
  return {write, read, list: () => [...files.keys()].sort(), compile, artifact};
}
