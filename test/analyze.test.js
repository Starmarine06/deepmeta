'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { analyze, close } = require('../src/index');

const width = (t) => t[Object.keys(t).find((k) => k.endsWith(':ImageWidth'))];

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

test.after(() => close());

test('reads hashes, tags and strings from a plain image', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-test-'));
  const f = path.join(dir, 'a.png');
  fs.writeFileSync(f, PNG);
  const r = await analyze(f, { strings: true });
  assert.strictEqual(r.hashes.sha256.length, 64);
  assert.strictEqual(width(r.exiftool), 1);
  assert.ok(r.strings);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('opens a zip-based document and recurses into embedded files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-test-'));
  const zip = new AdmZip();
  zip.addFile('docProps/core.xml', Buffer.from('<cp:coreProperties><dc:creator>Test Author</dc:creator></cp:coreProperties>'));
  zip.addFile('word/media/image1.png', PNG);
  const f = path.join(dir, 'doc.docx');
  zip.writeZip(f);
  const r = await analyze(f);
  assert.match(r.container.textParts['docProps/core.xml'], /Test Author/);
  const img = r.container.entries.find((e) => e.name === 'word/media/image1.png');
  assert.strictEqual(width(img.analysis.exiftool), 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
