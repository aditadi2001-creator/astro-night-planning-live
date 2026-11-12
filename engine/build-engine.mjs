#!/usr/bin/env node
// Builds Stellarium Web Engine (AGPL-3.0) to WebAssembly without SCons.
//
// This mirrors the upstream SConstruct (release mode, ES6 module output) so the
// same build works on Linux CI and on Windows/macOS dev machines. Emscripten
// must be on PATH (source emsdk_env first). The pinned version lives in
// engine/EMSDK_VERSION and the upstream commit in engine/SWE_COMMIT.
//
// Usage: node engine/build-engine.mjs <path-to-stellarium-web-engine> [outDir]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';

const src = resolve(process.argv[2] ?? '');
const outDir = resolve(process.argv[3] ?? 'public/engine');
if (!existsSync(join(src, 'SConstruct'))) {
  console.error('Pass the stellarium-web-engine checkout as the first argument.');
  process.exit(1);
}

const isWin = process.platform === 'win32';
const emcc = isWin ? 'emcc.bat' : 'emcc';
const python = process.env.EMSDK_PYTHON || (isWin ? 'python' : 'python3');

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed with ${r.status}`);
};

const glob = (dir, re) =>
  existsSync(join(src, dir))
    ? readdirSync(join(src, dir))
        .filter((f) => re.test(f))
        .map((f) => `${dir}/${f}`)
    : [];

// 0. Apply our patches (engine/patches/*.patch) unless already applied.
const patchDir = join(dirname(fileURLToPath(import.meta.url)), 'patches');
for (const p of existsSync(patchDir)
  ? readdirSync(patchDir)
      .filter((f) => f.endsWith('.patch'))
      .sort()
  : []) {
  const file = join(patchDir, p);
  const git = (...a) =>
    spawnSync('git', ['-C', src, 'apply', '--ignore-whitespace', ...a, file], { stdio: 'pipe' });
  if (git('--reverse', '--check').status === 0) {
    console.log(`patch ${p}: already applied`);
    continue;
  }
  const r = git();
  if (r.status !== 0) throw new Error(`patch ${p} failed:\n${r.stderr}`);
  console.log(`patch ${p}: applied`);
}

// 1. Shaders, fonts and textures are embedded in src/assets/*.inl, which upstream
// commits. Our patches change no asset, so by default we use those files as-is.
// Set SWE_MAKE_ASSETS=1 to regenerate them with upstream tools/make-assets.py.
// That script refuses to run unless __file__ is exactly "./tools/make-assets.py"
// (Python >= 3.9 makes it absolute) and assumes '/' separators, so we run it
// through runpy with __file__ set the way it expects (POSIX only).
if (process.env.SWE_MAKE_ASSETS === '1' && !isWin) {
  const code =
    "import runpy,sys; sys.argv=['./tools/make-assets.py']; " +
    "runpy.run_path('./tools/make-assets.py', init_globals={'__file__': './tools/make-assets.py'}, run_name='__main__')";
  run(python, ['-c', code], { cwd: src });
} else {
  console.log('Using the pre-generated src/assets/*.inl from upstream.');
}

// 2. Same source list as SConstruct.
const C = /\.c$/;
let sources = [
  ...glob('src', /\.c(pp)?$/),
  ...glob('src/algos', C),
  ...glob('src/projections', C),
  ...glob('src/modules', C),
  ...glob('src/utils', C),
  ...glob('src/private', C),
  ...glob('ext_src/erfa', C),
  ...glob('ext_src/json', C),
  ...glob('ext_src/zlib', C),
  ...glob('ext_src/inih', C),
  ...glob('ext_src/nanovg', C),
  ...glob('ext_src/md4c', C),
];
const webp = [
  'dec/alpha_dec',
  'dec/buffer_dec',
  'dec/frame_dec',
  'dec/idec_dec',
  'dec/io_dec',
  'dec/quant_dec',
  'dec/tree_dec',
  'dec/vp8_dec',
  'dec/vp8l_dec',
  'dec/webp_dec',
  'utils/bit_reader_utils',
  'utils/color_cache_utils',
  'utils/filters_utils',
  'utils/huffman_utils',
  'utils/quant_levels_dec_utils',
  'utils/random_utils',
  'utils/rescaler_utils',
  'utils/thread_utils',
  'utils/utils',
  'dsp/cpu',
  'dsp/dec_clip_tables',
  'dsp/alpha_processing',
  'dsp/dec',
  'dsp/filters',
  'dsp/lossless',
  'dsp/rescaler',
  'dsp/upsampling',
  'dsp/yuv',
].map((f) => `ext_src/webp/src/${f}.c`);
sources = [...sources, ...webp];

const includes = [
  'src',
  'ext_src/erfa',
  'ext_src/json',
  'ext_src/uthash',
  'ext_src/stb',
  'ext_src/zlib',
  'ext_src/inih',
  'ext_src/nanovg',
  'ext_src/md4c',
  'ext_src/webp',
  'ext_src/webp/src',
].map((d) => `-I${d}`);

const common = [
  '-O3',
  '-DNDEBUG',
  '-include',
  'config.h',
  '-Wno-initializer-overrides',
  '-DNO_LIBCURL',
  '-DNO_ARGP',
  '-DGLES2=1',
  '-DHAVE_UNISTD_H',
  '-DMD4C_USE_UTF8',
  '-D_GNU_SOURCE',
  '-Wall',
  '-Wno-unknown-pragmas',
  '-Wno-missing-braces',
  ...includes,
];
const cflags = ['-std=gnu11'];
const cxxflags = ['-std=gnu++11', '-Wno-narrowing', '-Wno-unused-function'];

// 3. Compile each translation unit (parallel), then link.
const objDir = join(src, 'build', 'obj');
mkdirSync(objDir, { recursive: true });
const jobs = Math.max(1, cpus().length);
const objects = [];
// An object is only reusable if it is newer than its source AND every header
// and embedded asset (a changed struct in a header must rebuild everything).
const newestHeader = (function walk(dir) {
  let t = 0;
  for (const e of readdirSync(join(src, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) t = Math.max(t, walk(p));
    else if (/\.(h|inl)$/.test(e.name)) t = Math.max(t, statSync(join(src, p)).mtimeMs);
  }
  return t;
})('src');
const queue = sources
  .map((s) => {
    const obj = join(objDir, s.replace(/[\\/]/g, '__') + '.o');
    objects.push(obj);
    const objTime = existsSync(obj) ? statSync(obj).mtimeMs : 0;
    const fresh = objTime > statSync(join(src, s)).mtimeMs && objTime > newestHeader;
    return fresh ? null : { s, obj };
  })
  .filter(Boolean);

const { spawn } = await import('node:child_process');
let failed = false;
async function worker() {
  while (queue.length && !failed) {
    const { s, obj } = queue.shift();
    const args = [...common, ...(s.endsWith('.cpp') ? cxxflags : cflags), '-c', s, '-o', obj];
    await new Promise((res) => {
      const p = spawn(emcc, args, { cwd: src, stdio: 'inherit', shell: isWin });
      p.on('exit', (code) => {
        if (code !== 0) {
          failed = true;
          console.error(`FAILED: ${s}`);
        }
        res();
      });
    });
  }
}
console.log(`Compiling ${queue.length}/${sources.length} files with ${jobs} jobs…`);
await Promise.all(Array.from({ length: jobs }, worker));
if (failed) process.exit(1);

const exported = [
  'ALLOC_NORMAL',
  'GL',
  'UTF8ToString',
  '_free',
  '_malloc',
  'addFunction',
  'allocate',
  'ccall',
  'cwrap',
  'getValue',
  'intArrayFromString',
  'lengthBytesUTF8',
  'removeFunction',
  'setValue',
  'stringToUTF8',
  'writeAsciiToMemory',
  'writeArrayToMemory',
]
  .map((x) => `'${x}'`)
  .join(',');

const linkFlags = [
  '-O3',
  '-s',
  'MODULARIZE=1',
  '-s',
  'EXPORT_NAME=StelWebEngine',
  '-s',
  'ALLOW_MEMORY_GROWTH=1',
  '-s',
  'ALLOW_TABLE_GROWTH=1',
  '--pre-js',
  'src/js/pre.js',
  '--pre-js',
  'src/js/obj.js',
  '--pre-js',
  'src/js/geojson.js',
  '--pre-js',
  'src/js/canvas.js',
  '-s',
  'RESERVED_FUNCTION_POINTERS=10',
  '-s',
  'USE_WEBGL2=1',
  '-s',
  'NO_EXIT_RUNTIME=1',
  '-s',
  'EXPORTED_FUNCTIONS=[]',
  '-s',
  `EXTRA_EXPORTED_RUNTIME_METHODS=[${exported}]`,
  '-s',
  'FILESYSTEM=0',
  '-s',
  'EXPORT_ES6=1',
  '-s',
  'USE_ES6_IMPORT_META=0',
  '-lGL',
];
// Response file avoids the Windows command-line length limit.
const rsp = join(src, 'build', 'link.rsp');
const q = (a) => `"${a.replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
writeFileSync(
  rsp,
  [...objects, ...linkFlags, '-o', 'build/stellarium-web-engine.js'].map(q).join('\n'),
);
console.log('Linking…');
run(emcc, [`@${rsp}`], { cwd: src });

mkdirSync(outDir, { recursive: true });
for (const f of ['stellarium-web-engine.js', 'stellarium-web-engine.wasm']) {
  copyFileSync(join(src, 'build', f), join(outDir, f));
  console.log(`${f}: ${(statSync(join(outDir, f)).size / 1024).toFixed(0)} KiB`);
}
