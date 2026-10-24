import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import agentRules, { baselineRuleIds } from './agent-lint-rules.mjs';

export function ruleHint(rule) {
  return rule === '@typescript-eslint/explicit-module-boundary-types'
    ? 'Add an explicit return type to the exported boundary.'
    : agentRules.rules[rule?.replace(/^agent\//, '')]?.meta.docs.hint ?? 'Fix the reported lint violation.';
}

export function diagnosticFingerprint(message, source, tree = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true)) {
  const lines = source.split('\n');
  const offset = (line, column) => lines.slice(0, line - 1).reduce((length, text) => length + text.length + 1, 0) + column - 1;
  const start = offset(message.line, message.column);
  const end = message.endLine ? offset(message.endLine, message.endColumn) : start + 1;
  const declarations = [];
  function visit(node) {
    if (node.getStart(tree) > start || node.end < end) return;
    if (node.name) declarations.push([ts.SyntaxKind[node.kind], node.name.getText(tree)]);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return createHash('sha256').update(JSON.stringify([message.ruleId, message.messageId ?? message.message, source.slice(start, end), declarations])).digest('hex');
}

export function baselineOccurrences(results, root, sources) {
  const actual = {};
  for (const result of results) {
    const messages = result.messages.filter(message => baselineRuleIds.includes(message.ruleId));
    if (!messages.length) continue;
    const file = path.relative(root, result.filePath).replaceAll('\\', '/');
    const source = sources.get(result.filePath);
    const tree = ts.createSourceFile(result.filePath, source, ts.ScriptTarget.Latest, true);
    for (const message of messages) {
      actual[file] ??= {};
      (actual[file][message.ruleId] ??= []).push(diagnosticFingerprint(message, source, tree));
    }
  }
  return actual;
}

export function compareBaseline(actual, baseline, directories) {
  const failures = [];
  for (const file of new Set([...Object.keys(actual), ...Object.keys(baseline)])) {
    if (!directories.includes(file.split('/')[0])) continue;
    const saved = baseline[file];
    if (saved && (!saved.reason?.trim() || !saved.occurrences || !Object.keys(saved.occurrences).length ||
        Object.entries(saved.occurrences).some(([rule, fingerprints]) => !baselineRuleIds.includes(rule) ||
          !Array.isArray(fingerprints) || !fingerprints.length || fingerprints.some(id => !/^[a-f0-9]{64}$/.test(id))))) {
      failures.push(`${file}: invalid baseline. Keep occurrence fingerprints for known rules and document a reason, or remove the entry.`);
      continue;
    }
    for (const rule of new Set([...Object.keys(actual[file] ?? {}), ...Object.keys(saved?.occurrences ?? {})])) {
      const remaining = [...(actual[file]?.[rule] ?? [])];
      for (const fingerprint of saved?.occurrences[rule] ?? []) {
        const index = remaining.indexOf(fingerprint);
        if (index < 0) failures.push(`${file}: ${rule} baseline is stale. Remove the missing occurrence from eslint-baseline.json.`);
        else remaining.splice(index, 1);
      }
      if (remaining.length) failures.push(`${file}: ${rule} has ${remaining.length} new violation(s). ${ruleHint(rule)}`);
    }
  }
  return failures;
}

export function newDiagnostics(messages, source, saved, fileName = 'source.tsx') {
  if (!messages.some(message => baselineRuleIds.includes(message.ruleId))) return messages;
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const fingerprints = messages.map(message => baselineRuleIds.includes(message.ruleId) ? diagnosticFingerprint(message, source, tree) : null);
  const totals = new Map();
  for (const id of fingerprints) totals.set(id, (totals.get(id) ?? 0) + 1);
  return messages.filter((message, index) => {
    const id = fingerprints[index];
    if (id === null) return true;
    const allowed = saved?.occurrences?.[message.ruleId]?.filter(fingerprint => fingerprint === id).length ?? 0;
    return totals.get(id) > allowed;
  });
}
