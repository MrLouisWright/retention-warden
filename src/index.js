// retention-warden: lint a declarative data-retention policy (YAML/JSON). Zero dependencies. Louis Wright, MIT.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { buildReport, UsageError } from './core.js';
import { parseYaml, YamlError } from './yaml.js';

export * from './core.js';
export { parseYaml };

export const RULES = {
  'retention-parse-error': { severity: 'high', title: 'Policy file is not valid YAML/JSON or has the wrong shape' },
  'retention-category-unmapped': { severity: 'high', title: 'A data category held in a system has no retention rule' },
  'retention-period-missing': { severity: 'high', title: 'Rule has no retention period' },
  'retention-period-invalid': { severity: 'high', title: 'Retention period cannot be parsed (use ISO 8601 like P2Y, or "30 days", "6 months")' },
  'retention-conflict': { severity: 'high', title: 'Two rules give the same category (and system) different periods or actions' },
  'retention-indefinite': { severity: 'high', title: 'Personal data is kept indefinitely without a documented justification' },
  'retention-category-unknown': { severity: 'medium', title: 'Rule or system refers to a category that is not declared' },
  'retention-system-unknown': { severity: 'medium', title: 'Rule refers to a system that is not declared' },
  'retention-basis-missing': { severity: 'medium', title: 'Rule has no legal basis or justification for the period' },
  'retention-action-missing': { severity: 'medium', title: 'Rule does not say what happens at expiry (delete, anonymise, archive, review)' },
  'retention-exceeds-max': { severity: 'medium', title: 'Period is longer than the policy maximum (maxPeriod / specialMaxPeriod)' },
  'retention-trigger-missing': { severity: 'low', title: 'Rule does not say when the period starts (collection, last activity, contract end, ...)' },
  'retention-owner-missing': { severity: 'low', title: 'Rule or system has no accountable owner' },
  'retention-review-overdue': { severity: 'low', title: 'Policy review date is missing or older than reviewEveryMonths' },
  'retention-duplicate': { severity: 'low', title: 'Identical rule declared twice' },
  'retention-category-unused': { severity: 'info', title: 'Declared category is not held in any system and has no rule' },
};
const ACTIONS = new Set(['delete', 'erase', 'destroy', 'anonymise', 'anonymize', 'pseudonymise', 'pseudonymize', 'archive', 'review', 'aggregate']);
const UNITS = { d: 1, day: 1, days: 1, w: 7, week: 7, weeks: 7, m: 30.4375, mo: 30.4375, month: 30.4375, months: 30.4375, y: 365.25, yr: 365.25, year: 365.25, years: 365.25 };

/** Parse a retention period to days. Returns { days } | { indefinite: true } | null. */
export function parsePeriod(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v >= 0 ? { days: v } : null;
  const s = String(v).trim().toLowerCase();
  if (/^(indefinite(ly)?|forever|permanent(ly)?|unlimited|never|none)$/.test(s)) return { indefinite: true };
  const iso = /^p(?:(\d+(?:\.\d+)?)y)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)w)?(?:(\d+(?:\.\d+)?)d)?$/.exec(s);
  if (iso && s !== 'p') return { days: (+(iso[1] || 0)) * 365.25 + (+(iso[2] || 0)) * 30.4375 + (+(iso[3] || 0)) * 7 + (+(iso[4] || 0)) };
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/.exec(s);
  if (m && UNITS[m[2]] != null) return { days: +m[1] * UNITS[m[2]] };
  return null;
}
const fmt = (d) => (d >= 365.25 ? `${+(d / 365.25).toFixed(1)}y` : d >= 30 ? `${+(d / 30.4375).toFixed(1)}mo` : `${Math.round(d)}d`);
const asList = (v, key = 'id') => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => ({ [key]: k, ...(x && typeof x === 'object' ? x : {}) })) : []);
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function lintPolicy(doc, { file = 'retention.yml', lines = {}, now = new Date(), config = {} } = {}) {
  const raw = []; const add = (rule, subject, message, fix, path) => raw.push({ rule, severity: RULES[rule].severity, file, line: lines[path] || undefined, subject, message, fix });
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { add('retention-parse-error', 'root', 'Policy must be a mapping with categories, systems and rules', 'See the README for the format.', ''); return raw; }
  const categories = asList(doc.categories ?? doc.dataCategories); const systems = asList(doc.systems ?? doc.inventory); const rules = asList(doc.rules ?? doc.retention ?? doc.policies);
  const keyOf = (p) => (doc.categories ? 'categories' : 'dataCategories') + p;
  if (!rules.length) add('retention-parse-error', 'rules', 'No "rules" list found', 'Add rules: [{ category, period, action, basis, trigger }].', '');
  const cat = new Map(); categories.forEach((c, i) => { if (!c || !c.id) add('retention-parse-error', `categories[${i}]`, `Category #${i + 1} has no id`, 'Give each category an id.', keyOf(`[${i}]`)); else cat.set(String(c.id), { ...c, i }); });
  const sys = new Map(); systems.forEach((s, i) => { if (s?.id) sys.set(String(s.id), { ...s, i }); });
  const maxP = parsePeriod(doc.defaults?.maxPeriod ?? config.maxPeriod); const specialP = parsePeriod(doc.defaults?.specialMaxPeriod ?? config.specialMaxPeriod);
  const rulePath = (i) => `${doc.rules ? 'rules' : doc.retention ? 'retention' : 'policies'}[${i}]`;
  const seen = new Map(); const covered = new Set();
  rules.forEach((r, i) => {
    const P = rulePath(i); if (!r || typeof r !== 'object') { add('retention-parse-error', P, `Rule #${i + 1} is not a mapping`, 'Each rule needs category, period, action, basis.', P); return; }
    const cats = arr(r.category ?? r.categories).map(String); const syss = arr(r.system ?? r.systems).map(String);
    const label = `${cats.join(',') || '(no category)'}${syss.length ? ` in ${syss.join(',')}` : ''}`;
    if (!cats.length) add('retention-parse-error', `${P}`, `Rule #${i + 1} has no category`, 'Set "category".', P);
    for (const c of cats) { if (cat.size && !cat.has(c)) add('retention-category-unknown', c, `Rule #${i + 1} uses undeclared category "${c}"`, `Declare "${c}" under categories, or fix the id.`, `${P}.category`); for (const s of syss.length ? syss : ['*']) covered.add(`${c}|${s}`); }
    for (const s of syss) if (sys.size && !sys.has(s)) add('retention-system-unknown', s, `Rule #${i + 1} uses undeclared system "${s}"`, `Declare "${s}" under systems.`, `${P}.system`);
    const per = r.period ?? r.retention ?? r.retain ?? r.duration;
    const pp = parsePeriod(per);
    const personal = cats.some((c) => cat.get(c)?.personal !== false); const special = cats.some((c) => cat.get(c)?.special === true || cat.get(c)?.sensitive === true);
    if (per == null || per === '') add('retention-period-missing', label, `Rule for ${label} has no period`, 'Set period, e.g. P2Y or "90 days".', P);
    else if (!pp) add('retention-period-invalid', label, `Period "${per}" for ${label} is not understood`, 'Use ISO 8601 (P30D, P6M, P2Y) or "<n> days|weeks|months|years".', `${P}.period`);
    else if (pp.indefinite && personal && !(r.justification || r.indefiniteReason)) add('retention-indefinite', label, `${label} is kept indefinitely`, 'Set a period, or document "justification" (e.g. statutory archive) and review it regularly.', `${P}.period`);
    else if (pp.days != null) {
      if (special && specialP?.days && pp.days > specialP.days) add('retention-exceeds-max', label, `Special-category data ${label} kept ${fmt(pp.days)}, over specialMaxPeriod ${fmt(specialP.days)}`, 'Shorten the period or document why it is necessary.', `${P}.period`);
      else if (maxP?.days && pp.days > maxP.days) add('retention-exceeds-max', label, `${label} kept ${fmt(pp.days)}, over maxPeriod ${fmt(maxP.days)}`, 'Shorten the period or raise maxPeriod with a reason.', `${P}.period`);
    }
    if (!(r.basis || r.legalBasis || r.justification || r.reason)) add('retention-basis-missing', label, `Rule for ${label} has no legal basis or justification`, 'Add "basis" (e.g. "HMRC: 6 years", "contract", "legitimate interest: fraud prevention").', P);
    const act = String(r.action ?? r.onExpiry ?? r.disposal ?? '').toLowerCase();
    if (!act) add('retention-action-missing', label, `Rule for ${label} has no action at expiry`, 'Set action: delete | anonymise | archive | review.', P);
    else if (!ACTIONS.has(act)) add('retention-action-missing', label, `Unknown action "${act}" for ${label}`, `Use one of: ${[...ACTIONS].join(', ')}.`, `${P}.action`);
    if (!(r.trigger || r.from || r.start || r.after)) add('retention-trigger-missing', label, `Rule for ${label} does not say when the period starts`, 'Add trigger, e.g. "account-closure", "last-activity", "collection", "contract-end".', P);
    if (!(r.owner || doc.owner || (syss.length && syss.every((s) => sys.get(s)?.owner)))) add('retention-owner-missing', label, `No owner for ${label}`, 'Add "owner" (team or role) to the rule, system or policy.', P);
    for (const c of cats) for (const s of syss.length ? syss : ['*']) {
      const k = `${c}|${s}`; const sig = `${pp?.days ?? (pp?.indefinite ? 'inf' : per)}|${act}`;
      if (seen.has(k)) { const prev = seen.get(k); if (prev.sig === sig && JSON.stringify(prev.r) === JSON.stringify(r)) add('retention-duplicate', k, `Rule #${i + 1} duplicates rule #${prev.i + 1} (${c}${s !== '*' ? ' in ' + s : ''})`, 'Remove the duplicate.', P); else if (prev.sig !== sig) add('retention-conflict', k, `Rules #${prev.i + 1} and #${i + 1} disagree for ${c}${s !== '*' ? ' in ' + s : ''}: ${prev.per ?? '?'}/${prev.act || '?'} vs ${per ?? '?'}/${act || '?'}`, 'Keep one rule per category and system (use a system-specific rule only where it really differs).', P); }
      else seen.set(k, { sig, i, r, per, act });
    }
  });
  // coverage: every category held in a system needs a rule (category-wide or system-specific)
  const held = new Set();
  systems.forEach((s, i) => { for (const c of arr(s?.categories ?? s?.data).map(String)) { held.add(c); if (cat.size && !cat.has(c)) add('retention-category-unknown', c, `System "${s.id}" holds undeclared category "${c}"`, `Declare "${c}" under categories.`, `${doc.systems ? 'systems' : 'inventory'}[${i}].categories`); if (!covered.has(`${c}|*`) && !covered.has(`${c}|${s.id}`)) add('retention-category-unmapped', `${c}|${s.id}`, `"${c}" is held in ${s.id} but no rule covers it`, `Add a rule for category "${c}" (optionally system "${s.id}").`, `${doc.systems ? 'systems' : 'inventory'}[${i}]`); }
    if (!s?.owner && !doc.owner && config.requireSystemOwner) add('retention-owner-missing', String(s?.id), `System "${s?.id}" has no owner`, 'Add owner.', `systems[${i}]`); });
  for (const [id, c] of cat) { const ruled = [...covered].some((k) => k.startsWith(id + '|')); if (!held.has(id) && !ruled) add('retention-category-unused', id, `Category "${id}" is declared but not held anywhere and has no rule`, 'Remove it, or map it to the systems that hold it.', keyOf(`[${c.i}]`)); if (systems.length === 0 && !ruled) add('retention-category-unmapped', id, `Category "${id}" has no retention rule`, `Add a rule for "${id}".`, keyOf(`[${c.i}]`)); }
  const months = doc.reviewEveryMonths ?? config.reviewEveryMonths ?? 12;
  const rv = doc.reviewed ?? doc.lastReviewed ?? doc.updated;
  const rd = rv ? new Date(String(rv)) : null;
  if (!rd || Number.isNaN(rd.getTime())) add('retention-review-overdue', 'reviewed', 'Policy has no "reviewed" date', 'Add reviewed: YYYY-MM-DD and review it at least yearly.', 'reviewed');
  else if ((now - rd) / 864e5 > months * 30.4375) add('retention-review-overdue', 'reviewed', `Policy last reviewed ${rd.toISOString().slice(0, 10)}, more than ${months} months ago`, 'Review the policy and update "reviewed".', 'reviewed');
  return raw;
}

export const DEFAULT_FILES = ['retention.yml', 'retention.yaml', 'retention.json', 'data-retention.yml', 'data-retention.yaml', 'data-retention.json', '.retention.yml'];
export function loadPolicy(file) {
  const text = readFileSync(file, 'utf8');
  if (/\.json$/i.test(file)) { try { return { value: JSON.parse(text), lines: {} }; } catch (e) { throw new YamlError(`invalid JSON: ${e.message}`, 1); } }
  return parseYaml(text);
}
export function check(target, opts = {}, config = {}, configFile) {
  const tool = { name: 'retention-warden', version: opts.toolVersion || '1.0.0', rules: RULES, emoji: '🗄️', defaultFile: 'retention.yml' };
  let file = target ? resolve(target) : null;
  if (!file || (existsSync(file) && !/\.(ya?ml|json)$/i.test(file))) { const dir = file || process.cwd(); const f = DEFAULT_FILES.map((n) => resolve(dir, n)).find((p) => existsSync(p)); if (!f) throw new UsageError(`No retention policy found (looked for ${DEFAULT_FILES.join(', ')})`); file = f; }
  if (!existsSync(file)) throw new UsageError(`No such file: ${file}`);
  const rel = relative(process.cwd(), file) || file;
  let raw;
  try { const { value, lines } = loadPolicy(file); raw = lintPolicy(value, { file: rel, lines, now: opts.now, config: { ...config, ...opts } }); }
  catch (e) { if (!(e instanceof YamlError)) throw e; raw = [{ rule: 'retention-parse-error', severity: 'high', file: rel, line: e.line, subject: 'parse', message: e.message, fix: 'Fix the syntax (retention-warden supports a YAML subset: maps, lists, inline [..]/{..}, quotes, comments).' }]; }
  return buildReport(tool, rel, raw, config, { now: opts.now, configFile, summaryLine: `policy ${rel}`, info: { file: rel } });
}
