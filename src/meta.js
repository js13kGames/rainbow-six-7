// Pure, injectable helpers for challenge codes, daily rotation, and local bests.
import { MODES, SKIRMISH, RELAY, RESCUE, DEADLINE, OPERATION, normRules, fail } from './engine.js';
export const LETTERS = { S: [1, 1], N: [1, 0], L: [2, 1], X: [3, 1], D: [4, 1], O: [5, 1] };
export const CODES = 'SNLXDO';
export function ruleLetter(r) {
  r=normRules(r);
  const letter = r.mode === SKIRMISH && !r.rockets ? 'N' : 'SLXDO'[MODES.indexOf(r.mode)];
  const canonical=ruleFromLetter(letter);
  if(Object.keys(r).some(k=>r[k]!==canonical[k])) fail('Unsupported challenge rules');
  return letter;
}
const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/[+/=]/g, c => '-_'['+/'.indexOf(c)] || '');
const unb64 = s => {
  try { return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))); } catch { return null; }
};
export function ruleFromLetter(l) {
  const i = CODES.indexOf(l);
  return i>=0 && CODES[i]===l ? { v: 1, mode: MODES[i?i-1:0], rockets: +(i!==1), mission: 0, dl: i===4 ? 10 : 0 } : null;
}
export const encodeCode = (rules, seed) => {
  return encodePreset(ruleLetter(rules), String(seed));
};
export const encodePreset = (letter, seed) => {
  if(!ruleFromLetter(letter)||seed.length>40)fail('Bad seed/rules');
  return `R7-1-${letter}-${b64(seed)}`;
};
export const decodeCode = code => decodePreset(String(code||'').trim());
export function decodePreset(code) {
  const m = /^R7-1-([A-Z])-([\w-]*)$/.exec(code);
  if (!m || m[2].length > 214) return null;
  const rules = ruleFromLetter(m[1]);
  if (!rules) return null;
  const seed = unb64(m[2]);
  return seed === null || seed.length > 40 || b64(seed)!==m[2] ? null : { rules, seed };
}
export function daily(dateStr=todayStr()) {
  if(!Number.isFinite(Date.parse(dateStr+'T00:00:00Z')))fail('Bad date');
  const code=dailyCode(dateStr);
  return {...decodeCode(code),code};
}
export function dailyCode(dateStr=new Date().toISOString().slice(0,10)) {
  const day = Date.parse(dateStr) / 864e5;
  return encodePreset(CODES[((day % 6) + 6) % 6], 'R7D1:' + dateStr);
}
export const todayStr = (now = new Date()) => now.toISOString().slice(0, 10);
export function better(mode, a, b) {
  if (!b) return true;
  const operation=mode===OPERATION, score=(a.score|0)-(b.score|0), rounds=(b.rounds|0)-(a.rounds|0);
  // First nonzero difference decides; fewer rounds or turns is better.
  return ((operation&&((a.missions|0)-(b.missions|0))) || (!!a.win-!!b.win) ||
    (mode===RELAY||mode===RESCUE ? rounds||score : score||(operation?rounds:(b.turns|0)-(a.turns|0))))>0;
}
export const makeStore = (storage, warn) => {
  const access=storageAccess(storage,warn);
  return {get:k=>access(k),set:(k,v)=>access(k,v)};
};
// Reads and writes share one guarded storage boundary. Browser storage is lazy.
export function storageAccess(storage, warn) {
  return function(k,v) {
    const write=arguments.length>1;
    v=JSON.stringify(v);
    let raw;
    try {
      raw=(storage||localStorage)[write?'setItem':'getItem'](k,v);
      return write ? true : raw ? JSON.parse(raw) : null;
    } catch {
      // A nonempty raw value means access succeeded but JSON parsing failed.
      warn?.(raw?'Corrupt best ignored':'Storage unavailable');
      if(!raw)warn=null;
      return write ? false : null;
    }
  };
}
const natural = (n, max = Infinity) => Number.isInteger(n) && n>=0 && n<=max;
export const record = (store,...args) => updateBest((k,v)=>v===undefined?store.get(k):store.set(k,v),...args);
export function readBest(store, code, mode) {
  let prev = store(code);
  if (prev && (typeof prev.win!=='boolean'||!Number.isFinite(prev.score)||
    !natural(mode===SKIRMISH||mode===DEADLINE?prev.turns:prev.rounds) ||
    !natural(prev.turns??0)||!natural(prev.rounds??0)||
    mode===OPERATION&&!natural(prev.missions,3))) prev = null;
  return prev||null;
}
export function updateBest(store, code, mode, attempt) {
  const prev=readBest(store,code,mode);
  if (better(mode, attempt, prev) && store(code, attempt)) return attempt;
  return prev;
}
