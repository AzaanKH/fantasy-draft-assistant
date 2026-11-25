import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { SLEEPER_DRAFT_HOSTS } from '@fantasy-draft/shared/sync';

const decodeManifest = Schema.decodeUnknownSync(Schema.Struct({
  host_permissions: Schema.Array(Schema.String),
  content_scripts: Schema.Array(Schema.Struct({ matches: Schema.Array(Schema.String), js: Schema.Array(Schema.String) })),
}));
const manifest = decodeManifest(JSON.parse(readFileSync(resolve(__dirname, '../../public/manifest.json'), 'utf8')));

const sleeperPattern = /^[^:]+:\/\/([^/]*sleeper\.(?:app|com))\//;
function sleeperHosts(patterns: readonly string[]): string[] {
  return patterns.flatMap(pattern => sleeperPattern.exec(pattern)?.[1] ?? []).sort();
}
const expected = [...SLEEPER_DRAFT_HOSTS].sort();

describe('extension manifest Sleeper hosts', () => {
  it('grants host permissions for exactly the hosts the draft URL parser accepts', () => {
    expect(sleeperHosts(manifest.host_permissions)).toEqual(expected);
  });

  it('injects the draft detector on exactly the hosts the draft URL parser accepts', () => {
    const detector = manifest.content_scripts.find(script => script.js.includes('content.js'));
    expect(sleeperHosts(detector?.matches ?? [])).toEqual(expected);
  });

  it('lists Sleeper hosts as the same https patterns wherever a manifest list includes Sleeper', () => {
    const lists = [manifest.host_permissions, ...manifest.content_scripts.map(script => script.matches)];
    for (const patterns of lists.filter(patterns => sleeperHosts(patterns).length > 0)) {
      expect(patterns.filter(pattern => sleeperPattern.test(pattern)).sort())
        .toEqual(expected.map(host => `https://${host}/*`).sort());
    }
  });
});
