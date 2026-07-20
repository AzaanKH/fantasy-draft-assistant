import { brotliCompressSync, gzipSync } from 'node:zlib';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { REPO_ROOT } from './model/duckdb.js';

const DIST_DIR = join(REPO_ROOT, 'web-app', 'dist');
const OUTPUT_FILE = join(REPO_ROOT, 'data', 'web-bundle-report.json');
const JS_GZIP_BUDGET = 160 * 1024;
const CSS_GZIP_BUDGET = 20 * 1024;

interface SourceMapFile {
  readonly sources?: readonly string[];
  readonly sourcesContent?: readonly (string | null)[];
}

function groupSource(source: string): string {
  const marker = '/node_modules/';
  const index = source.lastIndexOf(marker);
  if (index < 0) return 'application';
  const path = source.slice(index + marker.length);
  const parts = path.split('/');
  return parts[0]?.startsWith('@')
    ? `${parts[0] ?? 'unknown'}/${parts[1] ?? 'unknown'}`
    : parts[0] ?? 'unknown';
}

async function main(): Promise<void> {
  const assetDir = join(DIST_DIR, 'assets');
  const filenames = await readdir(assetDir);
  const assets = [];
  let totalJsGzip = 0;
  let totalCssGzip = 0;
  const composition = new Map<string, number>();

  for (const filename of filenames.sort()) {
    const path = join(assetDir, filename);
    if ((await stat(path)).isDirectory()) continue;
    const extension = extname(filename);
    if (extension === '.map') {
      const map = JSON.parse(await readFile(path, 'utf8')) as SourceMapFile;
      for (let index = 0; index < (map.sources?.length ?? 0); index += 1) {
        const source = map.sources?.[index];
        const content = map.sourcesContent?.[index];
        if (!source || !content) continue;
        const group = groupSource(source);
        composition.set(group, (composition.get(group) ?? 0) + Buffer.byteLength(content));
      }
      continue;
    }
    if (extension !== '.js' && extension !== '.css') continue;
    const content = await readFile(path);
    const asset = {
      file: basename(path),
      type: extension.slice(1),
      rawBytes: content.byteLength,
      gzipBytes: gzipSync(content).byteLength,
      brotliBytes: brotliCompressSync(content).byteLength,
    };
    assets.push(asset);
    if (extension === '.js') totalJsGzip += asset.gzipBytes;
    if (extension === '.css') totalCssGzip += asset.gzipBytes;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    budgets: {
      jsGzipBytes: JS_GZIP_BUDGET,
      cssGzipBytes: CSS_GZIP_BUDGET,
    },
    totals: {
      jsGzipBytes: totalJsGzip,
      cssGzipBytes: totalCssGzip,
    },
    passed: totalJsGzip <= JS_GZIP_BUDGET && totalCssGzip <= CSS_GZIP_BUDGET,
    assets,
    estimatedSourceComposition: [...composition.entries()]
      .map(([source, sourceBytes]) => ({ source, sourceBytes }))
      .sort((a, b) => b.sourceBytes - a.sourceBytes)
      .slice(0, 15),
    notes: [
      'Source composition is an unminified source-map estimate; use it for direction, not transfer-size accounting.',
      'Source-map files are excluded from transfer budgets.',
    ],
  };
  await writeFile(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('Web bundle measurement failed:', error);
  process.exit(1);
});
