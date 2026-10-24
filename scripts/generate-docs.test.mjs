import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMANDS } from '../cli/src/commands.ts';
import { catalogMetadata, catalogRetentionMetadata, catalogDataClassification } from '../shared/src/catalog/manifest.ts';
import agentRules, { baselineRuleIds } from './agent-lint-rules.mjs';
import { documentationSections, generateDocs, replaceGeneratedSection } from './generate-docs.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'draft-docs-'));
  temporaryRoots.push(root);
  for (const { file } of documentationSections()) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), await readFile(path.join(projectRoot, file), 'utf8'));
  }
  return root;
}

describe('documentation metadata ownership', () => {
  it('documents every command, catalog path, and agent rule from its owner', () => {
    const sections = documentationSections();
    const commands = sections.find(section => section.marker === 'cli-commands').content;
    for (const name of Object.keys(COMMANDS)) expect(commands).toContain(`draft ${name}`);
    const catalog = sections.find(section => section.marker === 'data-catalog').content;
    for (const entry of catalogMetadata()) expect(catalog).toContain(entry.path);
    const rules = sections.find(section => section.marker === 'agent-rules').content;
    for (const [name, rule] of Object.entries(agentRules.rules)) {
      expect(rules).toContain(`agent/${name}`);
      expect(rules).toContain(rule.meta.docs.description);
    }
    expect(rules).toContain('| `agent/no-closed-root-import` |');
    expect(rules.split('\n').find(line => line.includes('`agent/no-closed-root-import`'))).toMatch(/\| No allowance \|$/);
  });

  it('generates retention exceptions and prefixes from the classifier owner', () => {
    const section = documentationSections().find(section => section.marker === 'data-catalog').content;
    const retention = catalogRetentionMetadata();
    for (const path of retention.trackedPaths) {
      expect(section).toContain(`| \`${path}\` | Exact path | tracked |`);
      expect(catalogDataClassification(path)).toBe('tracked');
    }
    for (const prefix of retention.privatePrefixes) {
      expect(section).toContain(`| \`${prefix}\` | Prefix | private |`);
      expect(catalogDataClassification(`${prefix}fixture.json`)).toBe('private');
    }
  });

  it.each([{ setting: 'off' }, { setting: 0 }, { setting: ['off'] }, { setting: [0] }])('omits disabled config scopes for %j', ({ setting }) => {
    const section = documentationSections({
      rules: { example: { meta: { docs: { description: 'Fixture rule.' } } } },
      config: [
        { files: ['disabled.ts'], rules: { 'agent/example': setting } },
        { files: ['enabled.ts'], rules: { 'agent/example': 'error' } },
      ],
    }).find(section => section.marker === 'workspace-rules').content;
    expect(section).toContain('`enabled.ts`');
    expect(section).not.toContain('`disabled.ts`');
  });

  it.each([{ setting: 'off' }, { setting: 0 }, { setting: ['off'] }, { setting: [0] }])('rejects rules without enabled config scopes for %j', ({ setting }) => {
    expect(() => documentationSections({
      rules: { example: { meta: { docs: { description: 'Fixture rule.' } } } },
      config: [{ files: ['disabled.ts'], rules: { 'agent/example': setting } }],
    })).toThrow('agent/example has no enabled config block');
  });

  it('requires documentation on new rules, commands, and catalog entries', () => {
    expect(() => documentationSections({ rules: { missing: { meta: {} } } })).toThrow('agent/missing needs meta.docs.description');
    expect(() => documentationSections({ commands: { missing: { help: 'missing', examples: [] } } })).toThrow('Command missing needs help');
    expect(() => documentationSections({ catalog: [{ path: 'data/missing.json' }] })).toThrow('Catalog entry data/missing.json needs');
    const [entry] = catalogMetadata();
    expect(() => documentationSections({ catalog: [entry, entry] })).toThrow('unique path');
  });

  it('derives baseline allowances from the wrapper IDs', () => {
    const section = documentationSections({ baselineIds: [...baselineRuleIds, 'agent/no-domain-clock'] })
      .find(section => section.marker === 'agent-rules');
    expect(section.content.split('\n').find(line => line.includes('`agent/no-domain-clock`'))).toMatch(/\| Counts in eslint-baseline\.json \|$/);
  });
});

describe('bounded generated sections', () => {
  const section = { file: 'fixture.md', marker: 'fixture', content: 'new' };
  const start = '<!-- generated:fixture:start -->';
  const end = '<!-- generated:fixture:end -->';

  it.each(['', `${start}\nold`, `old\n${end}`, `${end}\n${start}`,
    `${start}\n${start}\n${end}`, `${start}\n${end}\n${end}`])('rejects missing, duplicate, or reversed markers: %s', document => {
    expect(() => replaceGeneratedSection(document, section)).toThrow('fixture.md must contain exactly one ordered pair');
  });

  it('preserves text outside the markers and is idempotent', () => {
    const generated = replaceGeneratedSection(`before\n${start}\nold\n${end}\nafter`, section);
    expect(generated).toBe(`before\n${start}\nnew\n${end}\nafter`);
    expect(replaceGeneratedSection(generated, section)).toBe(generated);
  });

  it('generates the committed documents without changes', async () => {
    expect(await generateDocs({ root: await fixture() })).toEqual([]);
  });

  it('fails hand-edited generated content without writing, then repairs only the section', async () => {
    const root = await fixture();
    const target = path.join(root, 'docs/cli.md');
    const original = await readFile(target, 'utf8');
    const edited = 'handwritten introduction\n' + original.replace('<!-- generated:cli-commands:start -->', '<!-- generated:cli-commands:start -->\nhand edit');
    await writeFile(target, edited);
    await expect(generateDocs({ root, check: true })).rejects.toThrow('Generated documentation drift in docs/cli.md. Run pnpm docs:generate');
    expect(await readFile(target, 'utf8')).toBe(edited);
    expect(await generateDocs({ root })).toEqual(['docs/cli.md']);
    expect(await readFile(target, 'utf8')).toBe('handwritten introduction\n' + original);
    expect(await generateDocs({ root, check: true })).toEqual([]);
    expect(await generateDocs({ root })).toEqual([]);
  });

  it('validates every document before writing any generated changes', async () => {
    const root = await fixture();
    const cli = path.join(root, 'docs/cli.md');
    const edited = (await readFile(cli, 'utf8')).replace('Check readiness', 'Hand edit');
    await writeFile(cli, edited);
    const agents = path.join(root, 'AGENTS.md');
    await writeFile(agents, (await readFile(agents, 'utf8')).replace('<!-- generated:agent-rules:end -->', ''));
    await expect(generateDocs({ root })).rejects.toThrow('AGENTS.md must contain exactly one ordered pair');
    expect(await readFile(cli, 'utf8')).toBe(edited);
  });
});
