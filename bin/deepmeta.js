#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { analyze, close } = require('../src/index');

const HELP = `deepmeta <file|folder> [more...] [options]
deepmeta edit <file> [options]      edit metadata (see: deepmeta edit --help)

Dump every piece of metadata and embedded data from any file.

Options:
  -o, --out <file>     write JSON to a file instead of stdout
  -s, --strings        also pull printable text (ASCII + UTF-16) out of the raw bytes
  --min-string <n>     minimum length for --strings (default 6)
  --depth <n>          how deep to go into archives and Office files (default: unlimited)
  -c, --compact        single-line JSON
  -V, --version        print the installed version
  -h, --help           show this help
`;

function walk(p, acc = []) {
  if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach((f) => walk(path.join(p, f), acc));
  else acc.push(p);
  return acc;
}

(async () => {
  const args = process.argv.slice(2);
  if (args[0] === '--version' || args[0] === '-V') {
    console.log(require('../package.json').version);
    return;
  }
  if (args[0] === 'edit') {
    try {
      await require('../src/edit').runEditCli(args.slice(1));
    } catch (e) {
      console.error(e.message || e);
      process.exitCode = 1;
    }
    await close();
    return;
  }
  const opts = {};
  const targets = [];
  let out;
  let compact = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      console.log(HELP);
      return;
    } else if (a === '-o' || a === '--out') out = args[++i];
    else if (a === '-s' || a === '--strings') opts.strings = true;
    else if (a === '--min-string') opts.minString = Number(args[++i]);
    else if (a === '--depth') opts.maxDepth = Number(args[++i]);
    else if (a === '-c' || a === '--compact') compact = true;
    else targets.push(a);
  }
  if (!targets.length) {
    console.error(HELP);
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const f of targets.flatMap((t) => walk(t))) {
    try {
      results.push(await analyze(f, opts));
    } catch (e) {
      results.push({ file: path.resolve(f), error: String(e.message || e) });
    }
  }
  const json = JSON.stringify(results.length === 1 ? results[0] : results, null, compact ? 0 : 2);
  if (out) fs.writeFileSync(out, json);
  else process.stdout.write(json + '\n');
  await close();
})();
