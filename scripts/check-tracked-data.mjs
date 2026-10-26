import { isUtf8 } from 'node:buffer';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogDataClassification } from '../shared/src/catalog/manifest.ts';
import { trackedFiles } from './tracked-files.mjs';
import { gateWorkspaces } from '../gate-workspaces.js';

export const maxTrackedBytes = 1024 * 1024;
export const referenceImages = new Map([
  ['docs/images/assistant.png', 'Public assistant reference artwork.'],
  ['docs/images/draft-workspace.png', 'Public draft workspace reference artwork.'],
]);
export const sourceAssets = new Map(Array.from({ length: 7 }, (_, index) => [
  `web-app/src/assets/fonts/typeface-${index}.woff2`,
  'Existing bundled font source preserves web typography; bounded by the ordinary file-size cap.',
]));
export const jsonAllowances = new Map([
  ['.mcp.json', 'Repository MCP configuration.'],
  ['package.json', 'Root workspace commands and dependencies.'],
  ['tsconfig.base.json', 'Shared TypeScript compiler configuration.'],
  ['eslint-baseline.json', 'Exact reasoned lint occurrence allowances.'],
  ['tracked-leak-baseline.json', 'Redacted exact reviewed leak allowances.'],
  ['web-app/components.json', 'UI component generator configuration.'],
  ['web-app/__bench__/tsconfig.json', 'TypeScript configuration for the existing UI benchmark.'],
  ['extension/public/manifest.json', 'Chrome extension manifest source.'],
  ['docs/design-system/tokens.json', 'Reviewed design-system tokens and public reference metadata.'],
  ['docs/design-system/pending-paper-import.json', 'Reviewed design-system source metadata.'],
  ['scripts/persistence/fixtures/worker-stop-without-close.json', 'Deterministic persistence regression commands, not a provider export.'],
]);
export const goldenSnapshots = new Map([
  'recommendations-linear-pick-50', 'recommendations-snake-pick-1', 'recommendations-snake-pick-100',
  'recommendations-snake-pick-50-keepers', 'recommendations-snake-pick-50',
].map(name => [`web-app/src/lib/calculations/__snapshots__/${name}.jsonl`,
  'Existing deterministic recommendation golden output, not a provider or model export; bounded by the ordinary file-size cap.']));
const workspaces = new Set(gateWorkspaces.map(workspace => workspace.directory));
const generatedKinds = /\.(?:csv|tsv|ndjson|jsonl|parquet|arrow|feather|duckdb(?:\..*)?|sqlite\d?|db|zip|gz|pdf|xlsx?|bin|wasm|png|jpe?g|gif|webp|ico)$/i;

export function trackedDataFailure(file, size, binary = false) {
  const label = JSON.stringify(file);
  if (file.startsWith('data/') || file.startsWith('demo-data/')) {
    const classification = catalogDataClassification(file);
    if (classification !== 'tracked') return `${label}: ${classification ?? 'unclassified'} data must stay untracked. Register retention at the catalog owner.`;
    if (binary) return `${label}: catalog data must be text, not binary content.`;
    if (size > maxTrackedBytes) return `${label}: catalog data exceeds ${maxTrackedBytes} bytes. Keep large generated data local.`;
    return null;
  }
  if (referenceImages.has(file)) {
    return size <= 8 * maxTrackedBytes ? null : `${label}: reference artwork exceeds 8388608 bytes.`;
  }
  if (size > maxTrackedBytes) return `${label}: exceeds ${maxTrackedBytes} bytes outside an exact allowed reference path.`;
  if (sourceAssets.has(file)) return null;
  if (binary) return `${label}: binary content requires an exact reviewed reference path.`;
  if (goldenSnapshots.has(file)) return null;
  if (/(?:^|\/)(?:dist|build|raw|exports|node_modules)\//.test(file) || generatedKinds.test(file)) {
    return `${label}: generated data, raw exports and binary assets require an exact reviewed allowed path.`;
  }
  if (file.endsWith('.json')) {
    const [workspace, name, extra] = file.split('/');
    const workspaceConfig = workspaces.has(workspace) && !extra && /^(?:package|tsconfig(?:\.build)?)\.json$/.test(name);
    if (!jsonAllowances.has(file) && !workspaceConfig) return `${label}: unclassified JSON requires a catalog path or an exact configuration/fixture allowance.`;
  }
  return null;
}

export async function checkTrackedData({ root = path.resolve(import.meta.dirname, '..') } = {}) {
  const files = await trackedFiles(root);
  const failures = files.map(file => trackedDataFailure(file.path, file.content.length, file.content.includes(0) || !isUtf8(file.content))).filter(Boolean);
  for (const failure of failures) console.error(failure);
  if (!failures.length) console.log(`Tracked-data policy passed (${files.length} files; source/data cap ${maxTrackedBytes} bytes).`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await checkTrackedData(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
