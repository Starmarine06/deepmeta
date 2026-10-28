'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

const bin = path.join(__dirname, '..', 'bin', 'deepmeta.js');

test('--version prints the package version', () => {
  const out = execFileSync(process.execPath, [bin, '--version']).toString().trim();
  assert.strictEqual(out, require('../package.json').version);
});
