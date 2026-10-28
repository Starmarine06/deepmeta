# deepmeta

Point it at a file. Get back everything it can find inside.

Images, audio, video, PDFs, Word and Excel files, archives, and binaries nobody has a name for. One JSON report per file.

## Install

```
npm install -g deepmeta
```

Or run it from a clone:

```
npm install
node bin/deepmeta.js photo.jpg
```

Needs Node 18 or newer. Windows works out of the box. On macOS and Linux, ExifTool runs on Perl, which ships with both. `ffprobe` is optional.

## Use

```
deepmeta report.pdf
deepmeta song.mp3 -o song.json
deepmeta ./evidence --strings
```

| Option | What it does |
|---|---|
| `-o, --out <file>` | Write JSON to a file |
| `-s, --strings` | Pull printable text (ASCII and UTF-16) out of the raw bytes |
| `--min-string <n>` | Shortest string to keep (default 6) |
| `--depth <n>` | How far to dig into archives and Office files (default: no limit) |
| `-c, --compact` | One-line JSON |

Folders are walked recursively.

## What's in the report

- **filesystem**: size, created, modified, accessed, changed, mode
- **hashes**: MD5, SHA-1, SHA-256
- **bytes**: first and last 64 bytes as hex, plus the ASCII view of the header
- **exiftool**: every tag ExifTool can read, with duplicates and unknown tags kept, grouped by source (EXIF, XMP, ID3, PDF, QuickTime and so on)
- **ffprobe**: streams, chapters, programs and container data (only if `ffprobe` is on your PATH)
- **rawXmp**: any XMP packet found anywhere in the bytes, even in formats ExifTool doesn't expect it in
- **strings**: printable text from the raw bytes (with `--strings`)
- **container**: for zip-based files (docx, xlsx, pptx, odt, epub, jar, apk, zip), every entry with its sizes, CRC and comments, the full text of every XML part (core and app properties, custom properties, comments, tracked changes), and a full report on each embedded image or media file

## Edit metadata

```
deepmeta edit photo.jpg
deepmeta edit photo.jpg --set XMP:Creator="Someone" --delete GPSLatitude
deepmeta edit photo.jpg --strip
```

With no flags it opens an interactive editor. Commands: `list [text]`, `set Tag=Value`, `del Tag`, `strip`, `pending`, `undo`, `save`, `quit`. Nothing is written until you `save`, and `save` prints a before and after for every tag it changed.

The original file is safe by default. Edits go to a copy named `photo.edited.jpg` (or the path you give with `-o`). Pass `--in-place` to overwrite the original, which keeps `photo.jpg.bak` unless you add `--no-backup`.

You can only edit formats ExifTool can write (JPEG, PNG, TIFF, PDF, MP3, MP4 and many more). For anything else you get a plain error and the file is left alone.

## Limits

Nothing is capped by default except one thing: files over 512 MB skip the raw XMP and strings scan to avoid loading the whole file into memory. Hashing, ExifTool and ffprobe still run on them.

Data a format encrypts, or data that was never written, can't be read. An unknown format still gets hashes, header bytes and strings.

## Test

```
npm test
```

## License

MIT
