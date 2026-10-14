// Minimal YAML subset parser: block maps and lists, inline [..] and {..}, scalars, quotes, comments. Louis Wright, MIT.
export class YamlError extends Error { constructor(msg, line) { super(`line ${line}: ${msg}`); this.line = line; } }
const scalar = (s, line) => {
  s = s.trim(); if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true; if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s[0] === '"') { try { return JSON.parse(s); } catch { throw new YamlError('bad double-quoted string', line); } }
  if (s[0] === "'") { if (!s.endsWith("'")) throw new YamlError('unterminated quoted string', line); return s.slice(1, -1).replace(/''/g, "'"); }
  if (s[0] === '[' || s[0] === '{') return flow(s, line);
  return s;
};
function flow(s, line) {
  let i = 0;
  const ws = () => { while (/\s/.test(s[i])) i++; };
  const val = () => { ws(); if (s[i] === '[') { i++; const a = []; ws(); if (s[i] === ']') { i++; return a; } for (;;) { a.push(val()); ws(); if (s[i] === ',') { i++; continue; } if (s[i] === ']') { i++; return a; } throw new YamlError('bad flow sequence', line); } }
    if (s[i] === '{') { i++; const o = {}; ws(); if (s[i] === '}') { i++; return o; } for (;;) { ws(); const k = tok(':'); i++; o[String(scalar(k, line))] = val(); ws(); if (s[i] === ',') { i++; continue; } if (s[i] === '}') { i++; return o; } throw new YamlError('bad flow mapping', line); } }
    return scalar(tok(',]}'), line); };
  const tok = (stop) => { ws(); let q = null; const st = i; for (; i < s.length; i++) { const c = s[i]; if (q) { if (c === q) q = null; continue; } if (c === '"' || c === "'") { q = c; continue; } if (stop.includes(c)) break; } if (i >= s.length && stop === ':') throw new YamlError('expected ":" in flow mapping', line); return s.slice(st, i); };
  const v = val(); ws(); if (i < s.length) throw new YamlError('trailing characters after flow value', line); return v;
}
const stripComment = (l) => { let q = null; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === q) q = null; continue; } if (c === '"' || c === "'") q = c; else if (c === '#' && (i === 0 || /\s/.test(l[i - 1]))) return l.slice(0, i); } return l; };
/** Parse YAML text. Also returns a line map: lines[path] = line number. */
export function parseYaml(text) {
  const raw = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const L = []; raw.forEach((l, n) => { if (/^\s*(---|\.\.\.)\s*$/.test(l)) return; const s = stripComment(l); if (!s.trim()) return; if (/\t/.test(s.match(/^\s*/)[0])) throw new YamlError('tabs are not allowed for indentation', n + 1); L.push({ ind: s.match(/^ */)[0].length, t: s.trim(), line: n + 1 }); });
  const lines = {}; let p = 0;
  const block = (ind, path) => {
    if (p >= L.length) return null;
    if (L[p].t.startsWith('- ') || L[p].t === '-') { const a = []; while (p < L.length && L[p].ind === ind && (L[p].t.startsWith('- ') || L[p].t === '-')) { const cur = L[p]; const rest = cur.t.slice(1).trim(); const ip = `${path}[${a.length}]`; lines[ip] = cur.line;
        if (!rest) { p++; a.push(p < L.length && L[p].ind > ind ? block(L[p].ind, ip) : null); }
        else if (/^[^"'[{][^:]*:(\s|$)/.test(rest) || /^["'][^"']+["']\s*:(\s|$)/.test(rest)) { L[p] = { ind: ind + 2, t: rest, line: cur.line }; a.push(block(ind + 2, ip)); }
        else { p++; a.push(scalar(rest, cur.line)); } }
      return a; }
    const o = {};
    while (p < L.length && L[p].ind === ind) {
      const cur = L[p]; if (cur.t.startsWith('- ')) throw new YamlError('unexpected list item', cur.line);
      const m = /^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/.exec(cur.t); if (!m) throw new YamlError(`expected "key: value", got "${cur.t}"`, cur.line);
      const key = String(scalar(m[1], cur.line)); const kp = path ? `${path}.${key}` : key; lines[kp] = cur.line;
      if (key in o) throw new YamlError(`duplicate key "${key}"`, cur.line);
      p++;
      if (m[2] != null && m[2] !== '' && m[2] !== '|' && m[2] !== '>') o[key] = scalar(m[2], cur.line);
      else if (m[2] === '|' || m[2] === '>') { const parts = []; while (p < L.length && L[p].ind > ind) parts.push(L[p++].t); o[key] = parts.join(m[2] === '|' ? '\n' : ' '); }
      else o[key] = p < L.length && L[p].ind > ind ? block(L[p].ind, kp) : (p < L.length && L[p].ind === ind && L[p].t.startsWith('- ') ? block(ind, kp) : null);
    }
    if (p < L.length && L[p].ind > ind) throw new YamlError('bad indentation', L[p].line);
    return o;
  };
  const v = L.length ? block(L[0].ind, '') : null;
  if (p < L.length) throw new YamlError('bad indentation', L[p].line);
  return { value: v, lines };
}
