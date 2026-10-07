// WP-1.5: generates the test HTML files under e2e/assets/ (08 section 10). Deterministic, no network, no secrets.
// run: npm run gen:probe            (small files + large-max.html)
//      npm run gen:probe -- --with-over-limit   (also large-over-limit.html, 52,428,801 bytes, for rejection tests)
//
//   probe.html           iframe isolation probe (S08-2): cookie read, top navigation, form submit, window.open, external fetch / image
//   charset-utf8-bom.html / charset-shift_jis.html / charset-euc-jp.html / charset-iso-2022-jp.html   charset detection (UV-12..)
//   large-max.html       exactly 52,428,800 bytes (the upper limit, accepted)   -- gitignored
//   large-over-limit.html  52,428,801 bytes (rejected with too_large)           -- gitignored, only with --with-over-limit
import { createWriteStream, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'assets')
const MAX_BYTES = 52_428_800 // 50 MiB (docs/05 4.3, UV-02 / UV-03)

const PROBE_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>probe</title>
</head>
<body>
<h1>probe</h1>
<p>Each line below is written by a script. A line with "blocked" means the isolation worked.</p>
<ul id="results"></ul>
<script>
(function () {
  var list = document.getElementById('results');
  function report(id, text) {
    var li = document.createElement('li');
    li.id = 'probe-' + id;
    li.textContent = id + ': ' + text;
    list.appendChild(li);
  }
  function errName(e) { return (e && e.name) ? e.name : String(e); }

  // 1. Cookie read. Under sandbox="allow-scripts" (opaque origin) reading throws SecurityError or returns an empty string.
  try {
    var c = document.cookie;
    report('cookie', c === '' ? 'empty' : 'READABLE length=' + c.length);
  } catch (e) {
    report('cookie', 'blocked (' + errName(e) + ')');
  }

  // 2. Top navigation. Without allow-top-navigation this throws or is ignored. The script cannot see an ignored navigation,
  //    so "attempted" means no exception; the E2E test checks that the top page URL did not change.
  try {
    window.top.location.href = 'https://example.invalid/top-navigation';
    report('top', 'attempted (no exception; verify the top URL did not change)');
  } catch (e) {
    report('top', 'blocked (' + errName(e) + ')');
  }

  // 3. Form submit to an external URL. Without allow-forms the submission is ignored silently.
  try {
    var f = document.createElement('form');
    f.method = 'post';
    f.action = 'https://example.invalid/form-submit';
    document.body.appendChild(f);
    f.submit();
    report('form', 'attempted (no exception; verify no navigation happened)');
  } catch (e) {
    report('form', 'blocked (' + errName(e) + ')');
  }

  // 4. window.open. Without allow-popups it returns null.
  try {
    var w = window.open('https://example.invalid/popup', '_blank');
    report('open', w ? 'OPENED' : 'blocked (null)');
  } catch (e) {
    report('open', 'blocked (' + errName(e) + ')');
  }

  // 5. External fetch (CSP connect-src 'none' on the content origin should reject it).
  try {
    fetch('https://example.invalid/fetch', { mode: 'no-cors' }).then(
      function () { report('fetch', 'RESOLVED (not blocked by CSP; DNS for .invalid should still fail)'); },
      function (e) { report('fetch', 'blocked (' + errName(e) + ')'); }
    );
  } catch (e) {
    report('fetch', 'blocked (' + errName(e) + ')');
  }

  // 6. External image (CSP img-src). onerror fires when it is blocked or when the host does not exist.
  var img = new Image();
  img.onload = function () { report('image', 'LOADED'); };
  img.onerror = function () { report('image', 'blocked (error event)'); };
  img.src = 'https://example.invalid/pixel.gif';

  // 7. localStorage. Under sandbox="allow-scripts" (opaque origin) access throws SecurityError.
  try {
    window.localStorage.setItem('probe', '1');
    report('storage', 'READABLE');
  } catch (e) {
    report('storage', 'blocked (' + errName(e) + ')');
  }
})();
</script>
</body>
</html>
`

/** Encodes a string made only of the characters used in this file's fixtures. Hand-written to avoid an undeclared iconv dependency. */
const SAMPLE = {
  // 日本語テスト = "Nihongo" (Japanese) + katakana "tesuto"
  sjis: Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67]),
  eucjp: Buffer.from([0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec, 0xa5, 0xc6, 0xa5, 0xb9, 0xa5, 0xc8]),
  // ISO-2022-JP: ESC $ B <JIS X 0208 pairs> ESC ( B
  jis: Buffer.from([0x1b, 0x24, 0x42, 0x46, 0x7c, 0x4b, 0x5c, 0x38, 0x6c, 0x25, 0x46, 0x25, 0x39, 0x25, 0x48, 0x1b, 0x28, 0x42]),
}
const SAMPLE_TEXT = '日本語テスト'

function decodeCheck(label: string, bytes: Buffer): void {
  const text = new TextDecoder(label, { fatal: true }).decode(bytes)
  if (text !== SAMPLE_TEXT) throw new Error(`self-check failed for ${label}: decoded text differs`)
}

function charsetHtml(label: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="${label}">\n<title>charset test</title>\n</head>\n<body>\n<p id="sample">`, 'ascii'),
    body,
    Buffer.from('</p>\n</body>\n</html>\n', 'ascii'),
  ])
}

async function writeLarge(path: string, totalBytes: number): Promise<void> {
  const head = Buffer.from('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<title>large</title>\n</head>\n<body>\n<pre>\n', 'ascii')
  const tail = Buffer.from('\n</pre>\n</body>\n</html>\n', 'ascii')
  const line = Buffer.from('0123456789abcdef'.repeat(4) + '\n', 'ascii') // 65 bytes
  const fillBytes = totalBytes - head.length - tail.length
  const chunk = Buffer.alloc(line.length * 1024)
  for (let i = 0; i < 1024; i++) line.copy(chunk, i * line.length)
  const out = createWriteStream(path)
  const write = async (b: Buffer): Promise<void> => {
    if (!out.write(b)) await once(out, 'drain')
  }
  await write(head)
  let remaining = fillBytes
  while (remaining > 0) {
    const n = Math.min(remaining, chunk.length)
    await write(n === chunk.length ? chunk : chunk.subarray(0, n))
    remaining -= n
  }
  await write(tail)
  out.end()
  await once(out, 'finish')
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  decodeCheck('shift_jis', SAMPLE.sjis)
  decodeCheck('euc-jp', SAMPLE.eucjp)
  decodeCheck('iso-2022-jp', SAMPLE.jis)

  const small: [string, Buffer][] = [
    ['probe.html', Buffer.from(PROBE_HTML, 'utf8')],
    ['charset-utf8-bom.html', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), charsetHtml('utf-8', Buffer.from(SAMPLE_TEXT, 'utf8'))])],
    ['charset-shift_jis.html', charsetHtml('Shift_JIS', SAMPLE.sjis)],
    ['charset-euc-jp.html', charsetHtml('EUC-JP', SAMPLE.eucjp)],
    ['charset-iso-2022-jp.html', charsetHtml('ISO-2022-JP', SAMPLE.jis)],
  ]
  for (const [name, buf] of small) writeFileSync(join(OUT_DIR, name), buf)

  const large: [string, number][] = [['large-max.html', MAX_BYTES]]
  if (process.argv.includes('--with-over-limit')) large.push(['large-over-limit.html', MAX_BYTES + 1])
  for (const [name, size] of large) await writeLarge(join(OUT_DIR, name), size)

  for (const [name] of [...small, ...large]) {
    console.error(`${name.padEnd(28)} ${String(statSync(join(OUT_DIR, name)).size).padStart(10)} bytes`)
  }
}

main().catch((e) => {
  console.error(`gen-probe-html: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
