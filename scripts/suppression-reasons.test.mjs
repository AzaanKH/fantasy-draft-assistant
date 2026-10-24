import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import agent from './agent-lint-rules.mjs';

function lint(source) {
  const linter = new Linter();
  const messages = linter.verify(source, [{ languageOptions: { parser: tseslint.parser }, plugins: { agent }, rules: { 'agent/reasoned-disable': 'error', 'agent/no-bare-fetch': 'error', 'no-console': 'error' } }]);
  const reasons = new Linter().verify(source, [{ languageOptions: { parser: tseslint.parser }, plugins: { agent }, rules: { 'agent/reasoned-disable': 'error' } }], { allowInlineConfig: false });
  return { visible: messages, enforced: [...messages.filter(message => message.ruleId !== 'agent/reasoned-disable'),
    ...reasons.filter(message => message.ruleId === 'agent/reasoned-disable')] };
}

describe('agent suppression reasons', () => {
  it.each(['/* eslint-disable agent/no-bare-fetch */', '// eslint-disable-next-line agent/no-bare-fetch',
    '/* eslint agent/no-bare-fetch: 0 */', '/* eslint agent/reasoned-disable: 0 */\n/* eslint-disable agent/no-bare-fetch */', '/* eslint-disable */', '/* eslint-disable -- */', '// eslint-disable-next-line', '/* eslint-disable agent/no-bare-fetch -- */',
    '/* eslint-disable agent/reasoned-disable, agent/no-bare-fetch */'])('rejects an unreasoned suppression even after ESLint suppresses findings: %s', comment => {
    const result = lint(`${comment}\nfetch('/api');`);
    expect(result.visible.some(message => message.ruleId === 'agent/no-bare-fetch')).toBe(false);
    expect(result.enforced.some(message => message.ruleId === 'agent/reasoned-disable')).toBe(true);
  });
  it.each(['/* eslint-disable agent/no-bare-fetch -- Tests an injected native transport. */',
    '/* eslint-disable -- The fixture demonstrates native transport behavior. */'])('allows a written reason: %s', comment => {
    expect(lint(`${comment}\nfetch('/api');`).enforced).toEqual([]);
  });
  it.each(['["off"]', '[0]', '["off", { "option": true }]', 'off'])('requires a reason for array or named severity %s', severity => {
    const comment = `/* eslint "agent/no-json-cast": ${severity} */`;
    expect(lint(comment).enforced.some(message => message.ruleId === 'agent/reasoned-disable')).toBe(true);
    const reasoned = `/* eslint "agent/no-json-cast": ${severity} -- The fixture tests legacy decoding. */`;
    expect(lint(reasoned).enforced.some(message => message.ruleId === 'agent/reasoned-disable')).toBe(false);
  });
  it('checks inline disables and leaves unrelated rule-specific directives alone', () => {
    expect(lint("fetch('/api'); // eslint-disable-line agent/no-bare-fetch").enforced.some(message => message.ruleId === 'agent/reasoned-disable')).toBe(true);
    expect(lint('/* eslint-disable no-console */\nconsole.log(1);').enforced).toEqual([]);
  });
});
