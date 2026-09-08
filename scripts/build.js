// build.js — produce a single, self-contained dist/index.html.
//
// esbuild bundles + minifies the vanilla JS (tree-shaking away unused engine
// exports) and minifies the CSS. Both are inlined into the HTML shell so the
// artifact has zero runtime dependencies and references no external files.
//
// The build GATES on an uncompressed byte budget: if the combined HTML+CSS+JS
// exceeds LIMIT bytes it fails loudly (non-zero exit). This is the hard size
// contract for the project.

import esbuild from 'esbuild';
import { minify } from 'terser';
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { TreeWalker, TreeTransformer, AST_SymbolFunarg,
  AST_String, AST_Sub, AST_SymbolRef } = await import(new URL('./lib/ast.js', import.meta.resolve('terser')));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// UNCOMPRESSED byte budget for the whole HTML+CSS+JS artifact.
//
const LIMIT = 13000;

async function bundleJS() {
  const r = await esbuild.build({
    entryPoints: [join(ROOT, 'src/game.js')],
    bundle: true,
    minify: true,
    // Private model fields only. Colliding native id/target/Array.map are quoted
    // in source, so esbuild preserves them (mangleQuoted remains false).
    mangleProps: /^(units|items|active|result|stats|score|kills|pickups|shots|hits|turns|moved|fired|used|team|hp|ammo|role|cover|path|seed|log|rules|mode|rockets|mission|dl|relay|rt|rn|rescue|carrier|secured|extract|victims|friends|enemies|impact|dist|rocket|threats|steps|weapon|pending|done|win|squad|inter|missions|rounds|state|reason|ok|damage|round|campaign|id|target|code|map)$/,
    mangleQuoted: false,
    format: 'iife',
    target: 'es2022',
    legalComments: 'none',
    write: false
  });
  const { ast } = await minify(r.outputFiles[0].text, {
    // Bundled helpers are never constructors; ES2022 arrows fund square map cells.
    compress: { passes: 3, unsafe_arrows: true },
    ecma: 2022,
    mangle: false,
    format: { ast: true, code: false }
  });
  const plain = allocateNames(ast);
  const variants = await Promise.all([0,4,8,12,16].map(overhead => poolNativeKeys(plain,overhead)));
  return [plain,...variants].sort((a,b)=>a.length-b.length)[0];
}

function allocateNames(ast) {
  ast.figure_out_scope();
  const scope = ast.body[0].body.expression;
  if (!scope?.variables) throw Error('Unexpected bundle scope');
  // Order symbol metadata, not statements: frequent bindings get short names.
  // Terser still performs all scope/shadowing collision checks.
  scope.variables = new Map([...scope.variables].sort((a,b) =>
    b[1].references.length - a[1].references.length));
  ast.compute_char_frequency({});
  ast.mangle_names({});
  return ast.print_to_string({ ascii_only: true });
}

async function poolNativeKeys(code, overhead) {
  const { ast } = await minify(code, {
    compress: false, mangle: false, format: { ast: true, code: false }
  });
  const counts = new Map(), names = new Set(), aliases = new Map();
  ast.walk(new TreeWalker(node => {
    if (node.TYPE === 'Dot') counts.set(node.property, (counts.get(node.property) || 0) + 1);
    if (typeof node.name === 'string') names.add(node.name);
  }));
  let serial = 0;
  for (const [key, count] of counts) {
    if ((key.length - 2) * count <= key.length + overhead) continue;
    let name;
    do { name = '__native' + serial++; } while (names.has(name));
    names.add(name); aliases.set(key, name);
  }
  if (!aliases.size) return code;
  const call = ast.body[0].body, scope = call.expression;
  for (const [value,name] of aliases) {
    scope.argnames.push(new AST_SymbolFunarg({name}));
    call.args.push(new AST_String({value}));
  }
  // Native keys are NOT renamed: object.length becomes object[key], where
  // key is the literal "length". Receivers, optional access and lookup order stay intact.
  return allocateNames(ast.transform(new TreeTransformer(null, node =>
    node.TYPE === 'Dot' && aliases.has(node.property)
      ? new AST_Sub({ expression: node.expression, optional: node.optional,
        property: new AST_SymbolRef({ name: aliases.get(node.property) }) })
      : node)));
}

async function bundleCSS() {
  const r = await esbuild.build({
    entryPoints: [join(ROOT, 'src/style.css')],
    bundle: true,
    minify: true,
    loader: { '.css': 'css' },
    legalComments: 'none',
    write: false
  });
  return r.outputFiles[0].text.trim();
}

function assertNoExternalRefs(html) {
  // Guard: no external images/fonts/assets/runtime libraries may sneak in.
  const bad = [
    /<link[^>]+href=/i,     // any linked stylesheet/asset (must be inlined)
    /<script[^>]+src=/i,    // external scripts
    /<img\b/i,
    /url\(\s*['"]?https?:/i, // remote url() in CSS
    /@import/i
  ];
  for (const re of bad) {
    if (re.test(html)) throw new Error(`External resource reference detected: ${re}`);
  }
}

export const LIMIT_BYTES = LIMIT;

// Build the artifact in memory (no disk write, no logging). Used by tests.
export async function buildArtifact() {
  const [js, css] = await Promise.all([bundleJS(), bundleCSS()]);
  const html = `<!doctype html><html lang=en><meta name=viewport content="width=device-width"><title>RAINBOW SIX7</title><style>${css}</style><body><script>${js}</script>`;
  assertNoExternalRefs(html);
  return { html, js, css, bytes: Buffer.byteLength(html, 'utf8') };
}

async function main() {
  const { html, js, css, bytes } = await buildArtifact();

  const jsB = Buffer.byteLength(js, 'utf8');
  const cssB = Buffer.byteLength(css, 'utf8');
  const shellB = bytes - jsB - cssB;
  const gz = gzipSync(Buffer.from(html, 'utf8')).length;
  console.log('--- RAINBOW SIX 7 build ---');
  console.log(`JS    : ${jsB} bytes`);
  console.log(`CSS   : ${cssB} bytes`);
  console.log(`shell : ${shellB} bytes`);
  console.log(`TOTAL : ${bytes} bytes uncompressed  (limit ${LIMIT})`);
  console.log(`margin: ${LIMIT - bytes} bytes`);
  console.log(`gzip  : ${gz} bytes (for reference only; the gate is uncompressed)`);
  if (bytes >= LIMIT) {
    console.error(`\nBUILD FAILED: artifact is ${bytes} bytes uncompressed, which is not < ${LIMIT}.`);
    process.exit(1);
  }
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  writeFileSync(join(ROOT, 'dist/index.html'), html);
  console.log('wrote dist/index.html');
  console.log('OK - under budget.');
}

// Only run the CLI build when executed directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
