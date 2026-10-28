'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');
const { exiftool } = require('exiftool-vendored');

const MAX_BUFFER_SCAN = 512 * 1024 * 1024;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const TEXT_PART = /\.(xml|rels|json|txt|csv|html?|css|js|ya?ml|md|svg|vml)$/i;

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const algos = {
      md5: crypto.createHash('md5'),
      sha1: crypto.createHash('sha1'),
      sha256: crypto.createHash('sha256'),
    };
    const s = fs.createReadStream(file);
    s.on('data', (c) => Object.values(algos).forEach((h) => h.update(c)));
    s.on('error', reject);
    s.on('end', () =>
      resolve(Object.fromEntries(Object.entries(algos).map(([k, h]) => [k, h.digest('hex')])))
    );
  });
}

const toAscii = (b) => [...b].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('');

function readEdges(file, size, n = 64) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(Math.min(n, size));
    fs.readSync(fd, head, 0, head.length, 0);
    const tail = Buffer.alloc(Math.min(n, size));
    fs.readSync(fd, tail, 0, tail.length, Math.max(0, size - tail.length));
    return { head: head.toString('hex'), headAscii: toAscii(head), tail: tail.toString('hex') };
  } finally {
    fs.closeSync(fd);
  }
}

function isZip(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    return ZIP_MAGIC.every((v, i) => b[i] === v);
  } finally {
    fs.closeSync(fd);
  }
}

function ffprobe(file) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', '-show_programs', '-show_private_data', file],
      { maxBuffer: 1 << 30 },
      (err, out) => {
        if (err) return resolve(null);
        try {
          resolve(JSON.parse(out));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function extractXmp(latin) {
  return (latin.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/g) || []).map((m) =>
    Buffer.from(m, 'latin1').toString('utf8')
  );
}

function extractStrings(latin, min) {
  const ascii = latin.match(new RegExp(`[\\x20-\\x7e]{${min},}`, 'g')) || [];
  const wide = latin.match(new RegExp(`(?:[\\x20-\\x7e]\\x00){${min},}`, 'g')) || [];
  return { ascii, utf16le: wide.map((s) => s.replace(/\x00/g, '')) };
}

async function readTags(file) {
  try {
    return await exiftool.read(file, ['-a', '-u', '-G1', '-ee3', '-struct', '-api', 'largefilesupport=1']);
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

async function readZip(file, opts, depth) {
  const zip = new AdmZip(file);
  const entries = [];
  const textParts = {};
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deepmeta-'));
  try {
    for (const e of zip.getEntries()) {
      const info = {
        name: e.entryName,
        directory: e.isDirectory,
        size: e.header.size,
        compressedSize: e.header.compressedSize,
        crc32: e.header.crc,
        modified: e.header.time,
        comment: e.comment || undefined,
        extra: e.extra && e.extra.length ? e.extra.toString('hex') : undefined,
      };
      if (!e.isDirectory) {
        const data = e.getData();
        if (TEXT_PART.test(e.entryName) || /^(docProps|customXml)\//.test(e.entryName)) {
          textParts[e.entryName] = data.toString('utf8');
        } else if (depth < opts.maxDepth) {
          const p = path.join(tmp, `${entries.length}_${path.basename(e.entryName)}`);
          fs.writeFileSync(p, data);
          info.analysis = await analyze(p, { ...opts, strings: false }, depth + 1);
          delete info.analysis.file;
        }
      }
      entries.push(info);
    }
    return { archiveComment: zip.getZipComment() || undefined, entries, textParts };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function analyze(file, opts = {}, depth = 0) {
  opts = { maxDepth: Infinity, strings: false, minString: 6, ...opts };
  const st = fs.statSync(file);
  const result = {
    file: path.resolve(file),
    filesystem: {
      size: st.size,
      created: st.birthtime,
      modified: st.mtime,
      accessed: st.atime,
      changed: st.ctime,
      mode: st.mode.toString(8),
    },
    hashes: await hashFile(file),
    bytes: readEdges(file, st.size),
    exiftool: await readTags(file),
    ffprobe: await ffprobe(file),
  };

  if (st.size > 0 && st.size <= MAX_BUFFER_SCAN) {
    const latin = fs.readFileSync(file).toString('latin1');
    const xmp = extractXmp(latin);
    if (xmp.length) result.rawXmp = xmp;
    if (opts.strings) result.strings = extractStrings(latin, opts.minString);
  } else if (st.size > MAX_BUFFER_SCAN) {
    result.notes = ['File over 512 MB: raw XMP and strings scan skipped, all other readers still ran.'];
  }

  if (st.size > 0 && isZip(file)) {
    try {
      result.container = await readZip(file, opts, depth);
    } catch (e) {
      result.container = { error: String(e.message || e) };
    }
  }
  return result;
}

const close = () => exiftool.end();
module.exports = { analyze, close };
