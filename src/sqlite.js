'use strict';
const fs = require('fs');

const MAGIC = 'SQLite format 3\u0000';
const ENCODINGS = { 1: 'UTF-8', 2: 'UTF-16le', 3: 'UTF-16be' };
const MAX_COUNTED_TABLES = 200;

function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(100);
    const n = fs.readSync(fd, b, 0, 100, 0);
    return n === 100 ? b : null;
  } finally {
    fs.closeSync(fd);
  }
}

function isSqlite(file) {
  const b = readHeader(file);
  return !!b && b.toString('latin1', 0, 16) === MAGIC;
}

function versionString(n) {
  if (!n) return undefined;
  return `${Math.floor(n / 1000000)}.${Math.floor(n / 1000) % 1000}.${n % 1000}`;
}

function parseHeader(b) {
  const pageSize = b.readUInt16BE(16);
  const appId = b.readUInt32BE(68);
  return {
    pageSize: pageSize === 1 ? 65536 : pageSize,
    pageCount: b.readUInt32BE(28),
    journalMode: b[18] === 2 || b[19] === 2 ? 'wal' : 'rollback',
    textEncoding: ENCODINGS[b.readUInt32BE(56)] || 'unknown',
    schemaFormat: b.readUInt32BE(44),
    schemaCookie: b.readUInt32BE(40),
    fileChangeCounter: b.readUInt32BE(24),
    freelistPages: b.readUInt32BE(36),
    userVersion: b.readInt32BE(60),
    applicationId: appId ? '0x' + appId.toString(16).padStart(8, '0') : 0,
    autoVacuum: b.readUInt32BE(52) !== 0,
    writtenBySqlite: versionString(b.readUInt32BE(96)),
  };
}

// node:sqlite ships with Node 22.5 and newer. Older runtimes still get the header.
function loadDriver() {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch {
    return null;
  }
}

function readSchema(file) {
  const DatabaseSync = loadDriver();
  if (!DatabaseSync) return { note: 'Schema listing needs Node 22.5 or newer (node:sqlite). Header fields are still complete.' };
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const objects = db
      .prepare("SELECT type, name, tbl_name AS \"table\", sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
      .all()
      .map((o) => ({ ...o }));
    let counted = 0;
    for (const o of objects) {
      if (o.type !== 'table' || counted >= MAX_COUNTED_TABLES) continue;
      counted++;
      try {
        o.rows = Number(db.prepare(`SELECT COUNT(*) AS n FROM "${o.name.replace(/"/g, '""')}"`).get().n);
      } catch (e) {
        o.rowsError = String(e.message || e);
      }
    }
    return { objects };
  } catch (e) {
    return { error: String(e.message || e) };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // already closed
      }
    }
  }
}

function readSqlite(file) {
  const b = readHeader(file);
  if (!b) return { error: 'File too short for a SQLite header.' };
  return { header: parseHeader(b), ...readSchema(file) };
}

module.exports = { isSqlite, readSqlite };
