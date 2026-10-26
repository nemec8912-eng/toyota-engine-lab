// Сборка: esbuild собирает src/main.ts в один бандл, статика копируется из public/.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';

const serve = process.argv.includes('--serve');
const version = new Date().toISOString().slice(0, 16).replace('T', ' ');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });

const html = readFileSync('index.html', 'utf8').replaceAll('%BUILD%', version);
writeFileSync('dist/index.html', html);
const sw = readFileSync('public/sw.js', 'utf8').replaceAll('%BUILD%', version);
writeFileSync('dist/sw.js', sw);

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: !serve,
  sourcemap: serve,
  format: 'esm',
  target: ['es2020', 'safari15'],
  outfile: 'dist/app.js',
  loader: { '.css': 'css' },
  define: { __BUILD__: JSON.stringify(version) },
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist', port: 5173 });
  console.log(`http://localhost:${port}`);
} else {
  await esbuild.build(options);
}
