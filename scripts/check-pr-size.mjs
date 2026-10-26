import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const maxPrFiles = 99;

export function changedFileCount({ root, base, head }) {
  if (!base || !head || base.startsWith('-') || head.startsWith('-')) throw new Error('Supply --base <commit> and --head <commit>.');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const ancestor = git(['merge-base', base, head]).trim();
    const records = git(['diff', '--name-status', '-z', '--find-renames', ancestor, head, '--']).split('\0');
    let count = 0;
    for (let index = 0; records[index];) {
      const status = records[index++];
      index += /^[RC]/.test(status) ? 2 : 1;
      count++;
    }
    return count;
  } catch {
    throw new Error('Cannot compare PR base/head. Fetch both commits and their merge-base history, then retry with --base and --head.');
  }
}

export async function checkPrSize(args = process.argv.slice(2), { root = process.cwd(), env = process.env } = {}) {
  let base;
  let head;
  for (let index = 0; index < args.length; index += 2) {
    if (!['--base', '--head'].includes(args[index]) || !args[index + 1]) throw new Error('Usage: pnpm check:pr-size --base <commit> --head <commit>');
    if (args[index] === '--base') base = args[index + 1];
    else head = args[index + 1];
  }
  if (!base && !head && env.GITHUB_EVENT_NAME === 'pull_request') {
    const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
    base = event.pull_request?.base?.sha;
    head = event.pull_request?.head?.sha;
    if (!base || !head) throw new Error('PR event is missing base/head commits.');
  }
  if (!base && !head) {
    console.log('PR size was not checked. Supply --base <commit> --head <commit> locally.');
    return 0;
  }
  const count = changedFileCount({ root, base, head });
  if (count > maxPrFiles) throw new Error(`PR changes ${count} files; the limit is ${maxPrFiles}. Split the change into independently green PRs.`);
  console.log(`PR size passed (${count}/${maxPrFiles} files; renames count once).`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await checkPrSize(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
