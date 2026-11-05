import test from 'node:test';
import assert from 'node:assert/strict';
import {initialLocale, messages} from './i18n.mjs';
import {makeSimulatorHtml} from './generator.mjs';
test('locale selection and translations cover both interfaces', () => {
  assert.equal(initialLocale('en','zh-CN'),'en'); assert.equal(initialLocale(null,'zh-CN'),'zh'); assert.equal(initialLocale(null,'en-US'),'en');
  assert.deepEqual(Object.keys(messages.zh).sort(),Object.keys(messages.en).sort());
  assert.deepEqual(Object.keys(messages.zh.statuses).sort(),Object.keys(messages.en.statuses).sort());
  assert.match(makeSimulatorHtml('', 'zh'), /lang="zh-CN"/); assert.match(makeSimulatorHtml('', 'en'), /lang="en"/);
});
