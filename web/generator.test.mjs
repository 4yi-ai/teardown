import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSimulator, generateSimulator, makeSimulatorHtml} from './generator.mjs';
import {createVisualReviewer} from './visual-review.mjs';

test('bundles three and denies server and arbitrary path imports', async () => {
  const bundle = await compileSimulator("import {Scene} from 'three'; window.scene = new Scene();");
  assert.match(bundle, /scene/);
  assert.doesNotMatch(bundle, /process\.emitWarning/);
  await assert.rejects(compileSimulator("import fs from 'node:fs';"));
  await assert.rejects(compileSimulator("import x from '../paths.mjs';"));
});

test('creates a multi-file project, repairs a build, and produces a sandboxed preview document', async () => {
  let attempts = 0;
  const plan = [
    ['write_file', {path: 'main.js', content: "import {value} from './part.js'; document.querySelector('#app').textContent=value;"}],
    ['build_simulator', {entry: 'main.js'}],
    ['write_file', {path: 'part.js', content: "export const value='OK';"}],
    ['build_simulator', {entry: 'main.js'}],
    ['finish', {}],
  ];
  const gateway = {complete: async ({messages}) => {
    if (attempts) assert.equal(messages.at(-1).role, 'tool');
    const [name, args] = plan[attempts++];
    return {role: 'assistant', tool_calls: [{id: `call-${attempts}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]};
  }};
  const output = await generateSimulator({gateway, description: 'A simple crank mechanism'});
  assert.equal(attempts, 5);
  assert.deepEqual(output.files, ['main.js', 'part.js']);
  assert.match(output.html, /connect-src 'none'/);
  assert.match(makeSimulatorHtml('</script>'), /<\\\/script>/);
});

test('repairs truncated tool arguments with a valid follow-up message', async () => {
  let attempts = 0;
  const gateway = {complete: async ({messages}) => {
    attempts++;
    if (attempts === 2) assert.equal(messages.at(-2).tool_calls[0].function.arguments, '{}');
    const action = attempts === 1 ? ['write_file', '{"path":'] : attempts === 2 ? ['write_file', JSON.stringify({path: 'main.js', content: "document.querySelector('#app').textContent='OK'"})] : attempts === 3 ? ['build_simulator', JSON.stringify({entry: 'main.js'})] : ['finish', '{}'];
    return {role: 'assistant', tool_calls: [{id: 'c', type: 'function', function: {name: action[0], arguments: action[1]}}]};
  }};
  const output = await generateSimulator({gateway, description: 'A simple crank mechanism'});
  assert.equal(attempts, 4);
  assert.match(output.html, /<script>/);
});

test('visual review sends a rendered frame to the vision model and validates its decision', async () => {
  let visionCalls = 0;
  const reviewer = createVisualReviewer({render: async () => ({canvasCount: 1, errors: [], image: 'YWJj'}), gateway: {complete: async ({messages}) => {
    visionCalls++;
    assert.match(messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    return {content: '{"passed":false,"feedback":"The mechanism is blank."}'};
  }}});
  assert.deepEqual(await reviewer({html: '<html/>', description: 'A crank mechanism'}), {passed: false, feedback: 'The mechanism is blank.'});
  assert.equal(visionCalls, 1);
  const empty = createVisualReviewer({render: async () => ({canvasCount: 0, errors: [], image: 'YWJj'}), gateway: {complete: async () => {throw new Error('unexpected');}}});
  assert.equal((await empty({html: '<html/>', description: 'A crank mechanism'})).passed, false);
  const invalid = createVisualReviewer({render: async () => ({canvasCount: 1, errors: [], image: 'YWJj'}), gateway: {complete: async () => ({content: 'not json'})}});
  await assert.rejects(invalid({html: '<html/>', description: 'A crank mechanism'}), /visual_review_invalid/);
});

test('agent repairs a failed visual review before completing', async () => {
  const plan = [
    ['write_file', {path: 'main.js', content: "document.querySelector('#app').textContent='before'"}],
    ['build_simulator', {entry: 'main.js'}], ['finish', {}],
    ['write_file', {path: 'main.js', content: "document.querySelector('#app').textContent='after'"}],
    ['build_simulator', {entry: 'main.js'}], ['finish', {}],
  ];
  let attempts = 0; let reviews = 0;
  const gateway = {complete: async ({messages}) => {
    if (attempts === 3) assert.match(messages.at(-1).content, /visual_review_failed/);
    const [name, args] = plan[attempts++];
    return {role: 'assistant', tool_calls: [{id: `call-${attempts}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]};
  }};
  const output = await generateSimulator({gateway, description: 'A simple crank mechanism', visualReview: async () => ({passed: ++reviews === 2, feedback: 'Repair the blank view.'})});
  assert.equal(reviews, 2);
  assert.equal(output.visualReviewed, true);
  assert.match(output.html, /after/);
});
