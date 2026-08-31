import { brotliCompressSync, gzipSync } from 'node:zlib';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import { BROWSER_DATA_ALLOWLIST } from './browser-data.js';
import { REPO_ROOT } from './model/duckdb.js';

const DIST_DIR = join(REPO_ROOT, 'web-app', 'dist');
const OUTPUT_FILE = join(REPO_ROOT, 'data', 'web-bundle-report.json');
const JS_GZIP_BUDGET = 160 * 1024;
const CSS_GZIP_BUDGET = 20 * 1024;
const STATIC_OUTPUT_BUDGET = 5 * 1024 * 1024;
const PROHIBITED_STATIC_EXTENSIONS = new Set(['.duckdb', '.ndjson', '.parquet']);

interface SourceMapFile {
  readonly sources?: readonly string[];
  readonly sourcesContent?: readonly (string | null)[];
}

interface StaticFile {
  readonly path: string;
  readonly bytes: number;
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

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

async function listStaticFiles(directory: string): Promise<StaticFile[]> {
  const files: StaticFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const fileStat = await stat(path);
    if (fileStat.isDirectory()) {
      files.push(...await listStaticFiles(path));
      continue;
    }
    files.push({
      path: normalizePath(relative(DIST_DIR, path)),
      bytes: fileStat.size,
    });
  }
  return files;
}

function prohibitedReason(path: string): string | undefined {
  const extension = extname(path).toLowerCase();
  if (PROHIBITED_STATIC_EXTENSIONS.has(extension)) {
    return `${extension} files must never be published`;
  }
  if (path.startsWith('data/') && !BROWSER_DATA_ALLOWLIST.has(path)) {
    return 'data file is not in the browser allowlist';
  }
  return undefined;
}

async function main(): Promise<void> {
  const staticFiles = await listStaticFiles(DIST_DIR);
  const totalStaticBytes = staticFiles.reduce((total, file) => total + file.bytes, 0);
  const prohibitedPaths = staticFiles.flatMap((file) => {
    const reason = prohibitedReason(file.path);
    return reason ? [{ path: file.path, reason }] : [];
  });
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
      staticOutputBytes: STATIC_OUTPUT_BUDGET,
    },
    totals: {
      jsGzipBytes: totalJsGzip,
      cssGzipBytes: totalCssGzip,
      staticOutputBytes: totalStaticBytes,
    },
    prohibitedPaths,
    passed:
      totalJsGzip <= JS_GZIP_BUDGET
      && totalCssGzip <= CSS_GZIP_BUDGET
      && totalStaticBytes <= STATIC_OUTPUT_BUDGET
      && prohibitedPaths.length === 0,
    assets,
    largestStaticFiles: staticFiles
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 15),
    estimatedSourceComposition: [...composition.entries()]
      .map(([source, sourceBytes]) => ({ source, sourceBytes }))
      .sort((a, b) => b.sourceBytes - a.sourceBytes)
      .slice(0, 15),
    notes: [
      'Source composition is an unminified source-map estimate; use it for direction, not transfer-size accounting.',
      'Source-map files are excluded from transfer budgets.',
      'Static-output size includes every file emitted under web-app/dist.',
      'Only browser-required JSON files in the data allowlist may be published under dist/data.',
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
