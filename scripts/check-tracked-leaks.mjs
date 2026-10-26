import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { trackedFiles } from './tracked-files.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const detectors = [
  ['credential', /\b(?:AKIA[0-9A-Z]{16}|(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})|xox[baprs]-[A-Za-z0-9-]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['credential-assignment', /\b(?:[A-Za-z_$][\w$]*(?:Token|Secret|Password|ApiKey|AccessKey|SecretKey)|token|secret|password|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key)\s*["']?\s*[:=]\s*(?:["'`][A-Za-z0-9_+\/@!.$%=-]{8,}["'`]|[A-Za-z0-9_+\/=-]{12,}(?=\s|$|[,}]))/gi],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+){0,2}\b/gi],
  ['jwt', /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{16,}\b/g],
  ['private-id', /(?<![\w.])\d{16,20}(?![\w.])/g],
  ['named-private-id', /\b(?:league|draft|user)[_-]?id["']?\s*[:=]\s*["'](?:\d{6,15}|[A-Za-z0-9_-]{24,})["']/gi],
  ['provider-url-id', /\bhttps?:\/\/(?:fantasy\.espn\.com\/football\/draft\/?\?(?:[^\s"'`<>#]*&)?leagueId=\d{1,15}(?=[&#\s"'`<>)]|$)|(?:football\.fantasysports\.yahoo\.com|sports-fantasy\.media\.yahoo\.com)\/(?:draftclient\/f1|draft\/f1|f1)\/\d{1,15}(?=[/?#\s"'`<>)]|$))/gi],
  ['league-name', /\b(?:leagueName|LEAGUE_NAME)["']?\s*[:=]\s*(["'])[^"'\n]{4,}\1/g],
  ['email', /(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['phone', /(?<![\w\d])(?:\+1[ .-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[ .-][2-9]\d{2}[ .-]\d{4}(?!\d)/g],
  ['street-address', /\b\d{1,6}\s+(?:[A-Za-z]+\s+){1,4}(?:Street|Avenue|Road|Lane|Drive|Boulevard|St|Ave|Rd)\b\.?/gi],
];

export function leakFindings(file, content) {
  // Latin-1 retains ASCII detector coverage in binary files without following embedded paths.
  const text = Buffer.isBuffer(content) ? content.toString('latin1') : content;
  const findings = [];
  for (const [detector, pattern] of detectors) {
    for (const match of text.matchAll(pattern)) {
      const prefix = text.slice(0, match.index);
      const line = prefix.split('\n').length;
      const column = match.index - prefix.lastIndexOf('\n');
      const lineStart = prefix.lastIndexOf('\n') + 1;
      const lineEnd = text.indexOf('\n', match.index);
      const fingerprint = createHash('sha256').update(JSON.stringify([
        detector, text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd), column,
      ])).digest('hex');
      findings.push({ file, detector, line, column, fingerprint });
    }
  }
  return findings;
}

export function compareLeakAllowances(findings, allowances) {
  if (!Array.isArray(allowances) || allowances.some(entry => !entry.file || !entry.detector || !entry.reason?.trim() ||
      !/^[a-f0-9]{64}$/.test(entry.fingerprint) || !Number.isInteger(entry.line) || !Number.isInteger(entry.column))) {
    throw new Error('Invalid leak baseline. Each exact occurrence needs a fingerprint, location, detector and written reason.');
  }
  const remaining = [...findings];
  const failures = [];
  for (const allowance of allowances) {
    const index = remaining.findIndex(finding => finding.file === allowance.file && finding.detector === allowance.detector &&
      finding.fingerprint === allowance.fingerprint);
    if (index < 0) failures.push(`${JSON.stringify(allowance.file)}: ${allowance.detector} allowance is stale. Remove it from tracked-leak-baseline.json.`);
    else remaining.splice(index, 1);
  }
  for (const finding of remaining) {
    failures.push(`${JSON.stringify(finding.file)}:${finding.line}:${finding.column}: ${finding.detector} finding [REDACTED]. Remove private content or document an exact reviewed allowance.`);
  }
  return failures;
}

export async function checkTrackedLeaks({ root = projectRoot, allowances } = {}) {
  const files = await trackedFiles(root);
  const baseline = allowances ?? JSON.parse(await readFile(path.join(root, 'tracked-leak-baseline.json'), 'utf8'));
  const failures = compareLeakAllowances(files.flatMap(file => leakFindings(file.path, file.content)), baseline);
  for (const failure of failures) console.error(failure);
  if (!failures.length) console.log(`Tracked-tree leak scan passed (${files.length} files; text and binary ASCII content scanned).`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--root')) throw new Error('Usage: node scripts/check-tracked-leaks.mjs [--root <git-repository>]');
    process.exitCode = await checkTrackedLeaks(args.length ? { root: path.resolve(args[1]) } : undefined);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
