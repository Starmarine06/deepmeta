'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { close } = require('../src/index');
const { save, readEditable } = require('../src/edit');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dm-edit-'));
const none = { set: {}, del: [], strip: false };

test.after(() => close());

test('edits a copy and leaves the original byte-identical', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.png');
  fs.writeFileSync(f, PNG);
  const before = sha(f);
  const { target, lines } = await save(f, { ...none, set: { 'XMP:Creator': 'Test Person' } }, {});
  assert.strictEqual(sha(f), before);
  assert.strictEqual(target, path.join(dir, 'a.edited.png'));
  const tags = await readEditable(target);
  assert.deepStrictEqual([].concat(tags['XMP-dc:Creator']), ['Test Person']);
  assert.ok(lines.length > 0);
  assert.ok(!fs.existsSync(`${target}_original`));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('deletes a tag and strips everything', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.png');
  fs.writeFileSync(f, PNG);
  const first = await save(f, { ...none, set: { 'XMP:Creator': 'X', 'XMP:Title': 'Y' } }, { out: path.join(dir, 'one.png') });
  const del = await save(first.target, { ...none, del: ['XMP:Creator'] }, { out: path.join(dir, 'two.png') });
  const tags = await readEditable(del.target);
  assert.strictEqual(tags['XMP-dc:Creator'], undefined);
  assert.strictEqual(tags['XMP-dc:Title'], 'Y');
  const stripped = await save(first.target, { ...none, strip: true }, { out: path.join(dir, 'three.png') });
  const left = await readEditable(stripped.target);
  assert.strictEqual(left['XMP-dc:Title'], undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--in-place overwrites and keeps a .bak', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.png');
  fs.writeFileSync(f, PNG);
  const orig = sha(f);
  await save(f, { ...none, set: { 'XMP:Title': 'Changed' } }, { inPlace: true });
  assert.notStrictEqual(sha(f), orig);
  assert.strictEqual(sha(`${f}.bak`), orig);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refuses to overwrite an existing output, and reports unwritable formats', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.png');
  fs.writeFileSync(f, PNG);
  fs.writeFileSync(path.join(dir, 'a.edited.png'), 'x');
  await assert.rejects(save(f, { ...none, set: { 'XMP:Title': 'T' } }, {}), /already exists/);

  const t = path.join(dir, 'notes.txt');
  fs.writeFileSync(t, 'plain text');
  await assert.rejects(save(t, { ...none, set: { 'XMP:Title': 'T' } }, {}), /Can't edit this file/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('edits the author of a Word file and leaves the original alone', async () => {
  const AdmZip = require('adm-zip');
  const dir = tmp();
  const z = new AdmZip();
  z.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
  z.addFile(
    'docProps/core.xml',
    Buffer.from('<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:creator>Old Name</dc:creator></cp:coreProperties>')
  );
  z.addFile('docProps/app.xml', Buffer.from('<Properties><Application>Word</Application></Properties>'));
  const f = path.join(dir, 'doc.docx');
  z.writeZip(f);
  const before = sha(f);

  const { target, lines } = await save(f, { ...none, set: { Author: 'ABCD & Co', LastModifiedBy: 'ABCD', Company: 'Acme' } }, {});
  assert.strictEqual(sha(f), before);
  const out = new AdmZip(target);
  const core = out.readAsText('docProps/core.xml');
  assert.match(core, /<dc:creator>ABCD &amp; Co<\/dc:creator>/);
  assert.ok(!core.includes('Old Name'), 'old author must be replaced, not left beside the new one');
  assert.strictEqual(core.match(/<dc:creator>/g).length, 1);
  assert.match(core, /<cp:lastModifiedBy>ABCD<\/cp:lastModifiedBy>/);
  assert.match(out.readAsText('docProps/app.xml'), /<Company>Acme<\/Company>/);
  assert.ok(lines.some((l) => /Old Name/.test(l)));

  await assert.rejects(save(f, { ...none, set: { Colour: 'red' } }, { out: path.join(dir, 'x.docx') }), /Editable here/);
  assert.ok(!fs.existsSync(path.join(dir, 'x.docx')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed edit leaves no stray .edited copy', async () => {
  const dir = tmp();
  const t = path.join(dir, 'notes.txt');
  fs.writeFileSync(t, 'plain');
  await assert.rejects(save(t, { ...none, set: { 'XMP:Title': 'T' } }, {}), /Can't edit/);
  assert.ok(!fs.existsSync(path.join(dir, 'notes.edited.txt')));
  fs.rmSync(dir, { recursive: true, force: true });
});
