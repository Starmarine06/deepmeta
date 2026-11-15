'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze, close } = require('../src/index');
const { isSqlite, readSqlite } = require('../src/sqlite');

let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  // Node older than 22.5
}

test.after(() => close());

// A valid 100-byte SQLite header, enough for the header reader on any Node version.
function fakeHeader() {
  const b = Buffer.alloc(4096);
  b.write('SQLite format 3\u0000', 0, 'latin1');
  b.writeUInt16BE(4096, 16);
  b[18] = 1;
  b[19] = 1;
  b.writeUInt32BE(7, 24);
  b.writeUInt32BE(1, 28);
  b.writeUInt32BE(4, 44);
  b.writeUInt32BE(1, 56);
  b.writeInt32BE(42, 60);
  b.writeUInt32BE(0x47504b47, 68);
  b.writeUInt32BE(3045001, 96);
  return b;
}

test('reads SQLite header fields without a driver', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-sqlite-'));
  const f = path.join(dir, 'h.db');
  fs.writeFileSync(f, fakeHeader());
  assert.ok(isSqlite(f));
  const r = readSqlite(f);
  assert.strictEqual(r.header.pageSize, 4096);
  assert.strictEqual(r.header.textEncoding, 'UTF-8');
  assert.strictEqual(r.header.userVersion, 42);
  assert.strictEqual(r.header.applicationId, '0x47504b47');
  assert.strictEqual(r.header.writtenBySqlite, '3.45.1');
  assert.strictEqual(r.header.journalMode, 'rollback');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('does not treat other files as SQLite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-sqlite-'));
  const f = path.join(dir, 'a.txt');
  fs.writeFileSync(f, 'SQLite format 4 is not a thing, and this is just text.');
  const tiny = path.join(dir, 'tiny.bin');
  fs.writeFileSync(tiny, 'SQLite');
  assert.ok(!isSqlite(f));
  assert.ok(!isSqlite(tiny));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lists tables, indexes, schema SQL and row counts from a real database', { skip: !DatabaseSync }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-sqlite-'));
  const f = path.join(dir, 'app.db');
  const db = new DatabaseSync(f);
  db.exec(`
    PRAGMA user_version = 7;
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
    CREATE TABLE "odd ""name" (x);
    CREATE INDEX users_email ON users (email);
    CREATE VIEW recent AS SELECT * FROM users;
    INSERT INTO users (email) VALUES ('a@example.com'), ('b@example.com'), ('c@example.com');
  `);
  db.close();

  const r = await analyze(f);
  assert.strictEqual(r.sqlite.header.userVersion, 7);
  const byName = Object.fromEntries(r.sqlite.objects.map((o) => [o.name, o]));
  assert.strictEqual(byName.users.type, 'table');
  assert.strictEqual(byName.users.rows, 3);
  assert.match(byName.users.sql, /email TEXT NOT NULL/);
  assert.strictEqual(byName.users_email.type, 'index');
  assert.strictEqual(byName.recent.type, 'view');
  assert.strictEqual(byName['odd "name'].rows, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a plain image has no sqlite section', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-sqlite-'));
  const f = path.join(dir, 'a.bin');
  fs.writeFileSync(f, Buffer.from([1, 2, 3, 4]));
  const r = await analyze(f);
  assert.strictEqual(r.sqlite, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
