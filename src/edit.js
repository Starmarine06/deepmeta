'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exiftool } = require('./index');

const HIDDEN_GROUPS = /^(System|ExifTool|File|Composite):/;
const WRITE_OPTS = { writeArgs: ['-overwrite_original'] };

const show = (v) => {
  if (v && typeof v === 'object') return v.rawValue ?? JSON.stringify(v);
  return String(v);
};

function editedName(file) {
  const { dir, name, ext } = path.parse(file);
  return path.join(dir, `${name}.edited${ext}`);
}

// Decide where the edit lands and make sure ExifTool only ever touches that path.
function prepareTarget(file, opts = {}) {
  if (opts.inPlace) {
    if (!opts.noBackup) fs.copyFileSync(file, `${file}.bak`);
    return file;
  }
  const target = path.resolve(opts.out || editedName(file));
  if (target === path.resolve(file)) throw new Error('Output path is the original file. Use --in-place to overwrite it.');
  if (fs.existsSync(target)) throw new Error(`${target} already exists. Pick another -o path.`);
  fs.copyFileSync(file, target);
  return target;
}

async function readEditable(file) {
  const tags = await exiftool.read(file, ['-a', '-G1', '-struct']);
  return Object.fromEntries(
    Object.entries(tags).filter(([k]) => k.includes(':') && !HIDDEN_GROUPS.test(k))
  );
}

async function applyEdits(target, { set = {}, del = [], strip = false }) {
  const tags = { ...set };
  for (const k of del) tags[k] = null;
  try {
    if (strip) await exiftool.deleteAllTags(target, WRITE_OPTS);
    if (Object.keys(tags).length) await exiftool.write(target, tags, WRITE_OPTS);
  } catch (e) {
    throw new Error(`Can't edit this file: ${String(e.message || e).split('\n')[0]}`);
  } finally {
    fs.rmSync(`${target}_original`, { force: true });
  }
}

function parseSet(items) {
  const set = {};
  for (const item of items) {
    const i = item.indexOf('=');
    if (i < 1) throw new Error(`Bad --set "${item}". Use Tag=Value or Group:Tag=Value.`);
    set[item.slice(0, i)] = item.slice(i + 1);
  }
  return set;
}

async function diffReport(before, after, keys) {
  const lines = [];
  for (const k of keys) {
    const bare = k.split(':').pop();
    const match = Object.keys({ ...before, ...after }).filter((x) => x === k || x.endsWith(`:${bare}`));
    for (const m of match.length ? match : [k]) {
      const b = before[m] === undefined ? '(none)' : show(before[m]);
      const a = after[m] === undefined ? '(none)' : show(after[m]);
      if (a !== b) lines.push(`  ${m}: ${b}  ->  ${a}`);
    }
  }
  return lines;
}

async function save(file, edits, opts) {
  const before = await readEditable(file);
  const target = prepareTarget(file, opts);
  await applyEdits(target, edits);
  const after = await readEditable(target);
  const keys = [...Object.keys(edits.set), ...edits.del];
  const lines = await diffReport(before, after, edits.strip ? Object.keys(before) : keys);
  return { target, lines };
}

const EDITOR_HELP = `Commands:
  list [text]        show tags (optionally only those containing text)
  set Tag=Value      queue a change, e.g. set XMP:Creator=Someone
  del Tag            queue a tag for deletion
  strip              queue removal of all metadata
  pending            show queued changes
  undo               drop the last queued change
  save               write changes (to a copy unless --in-place was given)
  quit               leave without saving
`;

async function editor(file, opts = {}) {
  const tags = await readEditable(file);
  const edits = { set: {}, del: [], strip: false };
  const history = [];
  const queued = () => edits.strip || edits.del.length || Object.keys(edits.set).length;

  // Returns true when the session is finished.
  async function handle(line) {
    const [cmd] = line.split(/\s+/);
    const rest = line.slice(cmd.length).trim();
    if (!cmd) return false;

    if (cmd === 'help') console.log(EDITOR_HELP);
    else if (cmd === 'list') {
      const needle = rest.toLowerCase();
      Object.entries(tags)
        .filter(([k, v]) => !needle || `${k} ${show(v)}`.toLowerCase().includes(needle))
        .forEach(([k, v]) => console.log(`  ${k} = ${show(v).slice(0, 120)}`));
    } else if (cmd === 'set') {
      try {
        Object.assign(edits.set, parseSet([rest]));
        history.push(['set', rest.slice(0, rest.indexOf('='))]);
      } catch (e) {
        console.log(e.message);
      }
    } else if (cmd === 'del') {
      if (!rest) console.log('Usage: del Tag');
      else {
        edits.del.push(rest);
        history.push(['del', rest]);
      }
    } else if (cmd === 'strip') {
      edits.strip = true;
      history.push(['strip']);
    } else if (cmd === 'pending') console.log(JSON.stringify(edits, null, 2));
    else if (cmd === 'undo') {
      const [kind, key] = history.pop() || [];
      if (kind === 'set') delete edits.set[key];
      else if (kind === 'del') edits.del.pop();
      else if (kind === 'strip') edits.strip = false;
      else console.log('Nothing to undo.');
    } else if (cmd === 'save') {
      if (!queued()) {
        console.log('Nothing queued.');
        return false;
      }
      try {
        const { target, lines } = await save(file, edits, opts);
        console.log(`Saved ${target}`);
        lines.forEach((l) => console.log(l));
        return true;
      } catch (e) {
        console.log(e.message);
      }
    } else if (cmd === 'quit' || cmd === 'exit') {
      console.log('Nothing written.');
      return true;
    } else console.log(`Unknown command "${cmd}". Type help.`);
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'edit> ' });
  console.log(`Editing ${file} (${Object.keys(tags).length} editable tags). Type "help".`);
  rl.prompt();
  let finished = false;
  for await (const line of rl) {
    if (await handle(line.trim())) {
      finished = true;
      break;
    }
    rl.prompt();
  }
  rl.close();
  if (!finished) console.log('Input ended. Nothing written.');
}

const EDIT_HELP = `deepmeta edit <file> [options]

With no --set/--delete/--strip it opens the interactive editor.

Options:
  --set Tag=Value     set a tag (repeatable), e.g. --set XMP:Creator=Someone
  --delete Tag        delete a tag (repeatable)
  --strip             remove all metadata
  -o, --out <file>    where to write the edited copy (default: name.edited.ext)
  --in-place          overwrite the original (keeps name.ext.bak)
  --no-backup         with --in-place, skip the .bak copy
  -h, --help          show this help

Only formats ExifTool can write are editable. The original is never touched unless you pass --in-place.
`;

async function runEditCli(args) {
  const opts = {};
  const set = [];
  const del = [];
  let strip = false;
  let file;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') { console.log(EDIT_HELP); return; }
    else if (a === '--set') set.push(args[++i] ?? '');
    else if (a === '--delete') del.push(args[++i] ?? '');
    else if (a === '--strip') strip = true;
    else if (a === '-o' || a === '--out') opts.out = args[++i];
    else if (a === '--in-place') opts.inPlace = true;
    else if (a === '--no-backup') opts.noBackup = true;
    else if (!file) file = a;
    else throw new Error(`Unexpected argument "${a}".`);
  }
  if (!file) { console.error(EDIT_HELP); process.exitCode = 1; return; }
  if (!fs.existsSync(file)) throw new Error(`${file} not found.`);
  if (opts.inPlace && opts.out) throw new Error('Use either --in-place or -o, not both.');

  if (!set.length && !del.length && !strip) return editor(file, opts);
  const { target, lines } = await save(file, { set: parseSet(set), del, strip }, opts);
  console.log(`Saved ${target}`);
  lines.forEach((l) => console.log(l));
}

module.exports = { runEditCli, editor, applyEdits, prepareTarget, readEditable, save };
