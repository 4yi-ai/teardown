import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createWorkspace} from './workspace.mjs';
import {isValidDescription} from './description.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const three = fileURLToPath(import.meta.resolve('three'));
const threeRoot = path.dirname(path.dirname(three));
const MAX_SOURCE = 160_000;

// Generated source is compiled, not executed, on the server. Only `three` is
// resolvable; in particular no filesystem paths or server modules are exposed.
export async function compileSimulator(source) {
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > MAX_SOURCE) throw new Error('invalid_source');
  const result = await build({
    stdin: {contents: source, sourcefile: 'generated.js', loader: 'js', resolveDir: root},
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
    logLevel: 'silent', minify: true,
    plugins: [{name: 'restricted-imports', setup(api) {
      api.onResolve({filter: /.*/}, args => {
        if (args.path === 'three') return {path: three};
        if (args.importer.startsWith(`${threeRoot}${path.sep}`) && args.path.startsWith('.')) {
          const resolved = path.resolve(path.dirname(args.importer), args.path);
          if (resolved.startsWith(`${threeRoot}${path.sep}`)) return {path: resolved};
        }
        return {errors: [{text: 'Only the three package can be imported'}]};
      });
    }}],
  });
  return result.outputFiles[0].text;
}

export function makeSimulatorHtml(script, locale = 'en') {
  const safeScript = script.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html lang="${locale === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>Teardown simulator</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#app{width:100%;height:100%}</style></head><body><main id="app"></main><script>${safeScript}</script></body></html>`;
}

const tool = (name, description, properties, required = []) => ({type: 'function', function: {name, description, parameters: {type: 'object', properties, required, additionalProperties: false}}});
const tools = [
  tool('write_file', 'Create or replace a JavaScript or JSON file in the project.', {path: {type: 'string'}, content: {type: 'string'}}, ['path', 'content']),
  tool('read_file', 'Read a project file.', {path: {type: 'string'}}, ['path']),
  tool('list_files', 'List project files.', {}),
  tool('build_simulator', 'Compile the project into a browser simulator.', {entry: {type: 'string'}}, ['entry']),
  tool('finish', 'Finish after a successful build; do not modify files afterward.', {}),
];

/** Runs bounded multi-file authoring and static compilation; generated code is never executed here. */
export async function generateSimulator({gateway, description, locale = 'zh', signal, onProgress = () => {}, visualReview}) {
  if (!isValidDescription(description)) throw new Error('invalid_description');
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  const workspace = createWorkspace();
  const messages = [{role: 'system', content: `You create interactive educational 3D mechanical simulators. Follow the principles in this skill where possible:\n${skill}\nUse write_file to create a small multi-file JavaScript project. Use main.js as the entry. Project-relative imports must include their .js extension; the only package import allowed is 'three'. Put UI and canvas in #app, use responsive sizing and animation, and include controls. Do not use fetch or external assets. Call build_simulator and fix any errors, then call finish. Keep each file concise. All visible interface text and labels must be in ${locale === 'en' ? 'English' : 'Simplified Chinese'}.`},
    {role: 'user', content: description.trim()}];
  let reviews = 0;
  for (let attempt = 0; attempt < 16; attempt++) {
    if (signal?.aborted) throw new Error('cancelled');
    onProgress(attempt === 0 ? 'generating' : 'working');
    const message = await gateway.complete({messages, tools, signal});
    const calls = message.tool_calls || [];
    if (!calls.length || calls.length > 8 || calls.some(call => !call.id || !call.function)) throw new Error('model_did_not_call_tools');
    const normalized = calls.map(call => { try { JSON.parse(call.function.arguments); return call; } catch { return {...call, function: {...call.function, arguments: '{}'}, invalidArguments: true}; } });
    messages.push({...message, tool_calls: normalized.map(({invalidArguments, ...call}) => call)});
    for (const call of normalized) {
      let result;
      try {
        if (call.invalidArguments) throw new Error('invalid_arguments');
        const input = JSON.parse(call.function.arguments);
        switch (call.function.name) {
          case 'write_file': result = workspace.write(input.path, input.content); break;
          case 'read_file': result = {content: workspace.read(input.path)}; break;
          case 'list_files': result = {files: workspace.list()}; break;
          case 'build_simulator': onProgress('building'); result = await workspace.compile(input.entry); break;
          case 'finish':
            if (calls.length !== 1) throw new Error('finish_must_be_separate');
            {
              const html = makeSimulatorHtml(workspace.artifact(), locale);
              if (visualReview) {
                if (++reviews > 3) throw new Error('visual_review_limit');
                onProgress('reviewing');
                const review = await visualReview({html, description, signal});
                if (!review.passed) {
                  result = {error: 'visual_review_failed', feedback: review.feedback, instruction: 'Fix the project, rebuild, and call finish again.'};
                  break;
                }
              }
              return {html, files: workspace.list(), visualReviewed: Boolean(visualReview)};
            }
          default: throw new Error('unknown_tool');
        }
      } catch (error) {
        // Renderer and vision failures are infrastructure failures, not code
        // the model can repair. Fail closed instead of accepting an unreviewed
        // result or spending additional model calls retrying the same failure.
        if (signal?.aborted || (call.function.name === 'finish' && visualReview && !['build_required', 'finish_must_be_separate'].includes(error.message))) throw error;
        result = {error: String(error?.errors?.[0]?.text || error.message).slice(0, 500)};
      }
      messages.push({role: 'tool', tool_call_id: call.id, content: JSON.stringify(result)});
    }
  }
  throw new Error('agent_step_limit');
}
