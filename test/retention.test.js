import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, parsePeriod, lintPolicy, runCli } from '../src/index.js';

const now = new Date('2026-10-14T00:00:00Z');
const ids = (r) => r.findings.map((f) => f.rule);
const lint = (doc) => lintPolicy(doc, { now }).map((f) => f.rule);
const base = { owner: 'x', reviewed: '2026-09-01', categories: [{ id: 'a' }], rules: [{ category: 'a', period: 'P1Y', action: 'delete', basis: 'contract', trigger: 'closure' }] };
const io = () => { const o = { s: '', e: '' }; return { o, io: { stdout: { write: (x) => { o.s += x; } }, stderr: { write: (x) => { o.e += x; } } } }; };

test('parsePeriod handles ISO, words and indefinite', () => {
  assert.equal(parsePeriod('P2Y').days, 730.5);
  assert.equal(parsePeriod('P30D').days, 30);
  assert.equal(Math.round(parsePeriod('6 months').days), 183);
  assert.equal(parsePeriod('90d').days, 90);
  assert.equal(parsePeriod(14).days, 14);
  assert.ok(parsePeriod('indefinite').indefinite);
  assert.equal(parsePeriod('soon'), null);
  assert.equal(parsePeriod('P'), null);
});
test('good fixture is clean', () => { const r = check('test/fixtures/good', { now }); assert.deepEqual(ids(r), []); });
test('bad fixture finds the expected problems', () => {
  const r = check('test/fixtures/bad/retention.yml', { now }); const s = new Set(ids(r));
  for (const k of ['retention-conflict', 'retention-exceeds-max', 'retention-action-missing', 'retention-basis-missing', 'retention-indefinite', 'retention-category-unknown', 'retention-system-unknown', 'retention-period-invalid', 'retention-category-unmapped', 'retention-review-overdue', 'retention-trigger-missing', 'retention-owner-missing', 'retention-category-unused']) assert.ok(s.has(k), k);
  assert.ok(r.findings.find((f) => f.rule === 'retention-conflict').line > 0);
});
test('minimal valid policy is clean', () => assert.deepEqual(lint(base), []));
test('missing period', () => assert.ok(lint({ ...base, rules: [{ ...base.rules[0], period: undefined }] }).includes('retention-period-missing')));
test('indefinite allowed with justification', () => { assert.ok(lint({ ...base, rules: [{ ...base.rules[0], period: 'indefinite' }] }).includes('retention-indefinite')); assert.deepEqual(lint({ ...base, rules: [{ ...base.rules[0], period: 'indefinite', justification: 'statutory archive' }] }), []); });
test('non-personal data may be kept indefinitely', () => assert.deepEqual(lint({ ...base, categories: [{ id: 'a', personal: false }], rules: [{ ...base.rules[0], period: 'forever' }] }), []));
test('special category max period', () => assert.ok(lint({ ...base, defaults: { specialMaxPeriod: 'P1Y' }, categories: [{ id: 'a', special: true }], rules: [{ ...base.rules[0], period: 'P2Y' }] }).includes('retention-exceeds-max')));
test('identical rule is a duplicate, not a conflict', () => { const l = lint({ ...base, rules: [base.rules[0], base.rules[0]] }); assert.ok(l.includes('retention-duplicate')); assert.ok(!l.includes('retention-conflict')); });
test('system-specific rule covers held category', () => assert.deepEqual(lint({ ...base, systems: [{ id: 's', categories: ['b'] }], categories: [{ id: 'a' }, { id: 'b' }], rules: [base.rules[0], { ...base.rules[0], category: 'b', system: 's' }] }), []));
test('categories without systems still need rules', () => assert.ok(lint({ ...base, categories: [{ id: 'a' }, { id: 'z' }] }).includes('retention-category-unmapped')));
test('map-style categories and rules accepted', () => assert.deepEqual(lint({ ...base, categories: { a: { name: 'A' } } }), []));
test('review overdue and missing', () => { assert.ok(lint({ ...base, reviewed: '2024-01-01' }).includes('retention-review-overdue')); assert.ok(lint({ ...base, reviewed: undefined }).includes('retention-review-overdue')); });
test('YAML syntax error becomes a finding with a line', () => {
  const d = mkdtempSync(join(tmpdir(), 'rw-')); writeFileSync(join(d, 'retention.yml'), 'rules:\n  - category: a\n\tperiod: x\n');
  const r = check(d, { now }); assert.equal(r.findings[0].rule, 'retention-parse-error'); assert.ok(r.findings[0].line);
});
test('JSON policy supported', () => { const d = mkdtempSync(join(tmpdir(), 'rw-')); writeFileSync(join(d, 'retention.json'), JSON.stringify(base)); assert.deepEqual(ids(check(d, { now })), []); });
test('CLI exit codes and SARIF', async () => {
  const cli = { name: 'retention-warden', version: '1.0.0', configKey: 'retentionWarden', rules: (await import('../src/index.js')).RULES, tagline: 't', usage: 'u', help: '', options: {}, dirFrom: () => '.', run: async ({ positionals }) => check(positionals[0], { now }) };
  let t = io(); assert.equal(await runCli(cli, ['test/fixtures/good', '--fail-on', 'low'], t.io), 0);
  t = io(); assert.equal(await runCli(cli, ['test/fixtures/bad', '-f', 'sarif'], t.io), 1); assert.equal(JSON.parse(t.o.s).version, '2.1.0');
  t = io(); assert.equal(await runCli(cli, ['test/fixtures/nope'], t.io), 2);
  t = io(); assert.equal(await runCli(cli, ['test/fixtures/bad', '--fail-on', 'none'], t.io), 0);
});
