import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [checkout, output] = process.argv.slice(2);
if (!checkout || !output) throw new Error('Pass checkout and output');
const { runDraft } = await import(pathToFileURL(`${checkout}/cli/src/run.ts`).href);
const { browserDataFiles } = await import(pathToFileURL(`${checkout}/shared/src/catalog/manifest.ts`).href);
const stdout: string[] = []; const stderr: string[] = [];
const code = await runDraft(['readiness', '--json'], { stdout: (value: string) => { stdout.push(value); }, stderr: (value: string) => { stderr.push(value); } }, {
  root: checkout, signal: new AbortController().signal, now: () => Date.parse('2026-08-10T12:00:00Z'), env: {},
});
const normalize = (value: string) => value.split(checkout).join('<checkout>');
writeFileSync(output, JSON.stringify({ code, stdout: stdout.map(value => JSON.parse(normalize(value))), stderr: stderr.map(normalize), demoFetchSet: browserDataFiles('demo') }, null, 2));
