import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hello } from '../src/index.js';

test('module loads and exposes its API', () => {
  assert.equal(typeof hello, 'function');
  assert.equal(hello(), 'schemaflint');
});
