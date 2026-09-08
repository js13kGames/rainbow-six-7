import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCode, decodeCode, daily, todayStr, better, makeStore, record, ruleLetter, storageAccess, readBest, updateBest } from '../src/meta.js';

test('challenge codes round-trip every mode and Unicode/ASCII seeds within limit', () => {
  const modes = [
    { mode: 'skirmish', rockets: 1 }, { mode: 'skirmish', rockets: 0 },
    { mode: 'relay', rockets: 1 }, { mode: 'rescue', rockets: 1 },
    { mode: 'deadline', rockets: 1 }, { mode: 'operation', rockets: 1 }
  ];
  for (const rules of modes) {
    for (const seed of ['abc', 'café-42', '12345', 'A_B-c', 'é'.repeat(40), '🐎'.repeat(20)]) {
      const code = encodeCode(rules, seed), d = decodeCode(code);
      assert.equal(d.seed, seed);
      assert.equal(d.rules.mode, rules.mode);
      assert.equal(d.rules.rockets, rules.rockets);
    }
  }
  assert.equal(ruleLetter({ mode: 'skirmish', rockets: 0 }), 'N');
});

test('malformed, oversized, unknown-version and unknown-mode codes reject', () => {
  assert.equal(decodeCode('garbage'), null);
  assert.equal(decodeCode('R7-2-S-YWJj'), null, 'unknown version');
  assert.equal(decodeCode('R7-1-Z-YWJj'), null, 'unknown mode');
  assert.equal(decodeCode('R7-1-S-' + 'A'.repeat(80)), null, 'oversized');
  assert.equal(decodeCode('R7-1-S-!!!'), null, 'bad chars');
  assert.equal(decodeCode(''), null);
  assert.equal(decodeCode('R7-1-S-Zh'), null, 'noncanonical unused bits');
  assert.throws(() => encodeCode({mode:'unknown'},'seed'));
  assert.throws(() => encodeCode({mode:'rescue',dl:10},'seed'), /rules/i);
  assert.throws(() => encodeCode({mode:'skirmish'},'a'.repeat(41)));
});

test('daily rotation uses UTC date; fixed seed/rules per day and differs across adjacent days', () => {
  const d1 = daily('2024-01-01'), d2 = daily('2024-01-02');
  assert.equal(d1.seed, 'R7D1:2024-01-01');
  assert.equal(daily('2024-01-01').code, d1.code, 'stable');
  assert.notEqual(d1.rules.mode + d1.rules.rockets, d2.rules.mode + d2.rules.rockets, 'rotation advances');
  // rotation cycles through all six over six days
  const letters = new Set();
  for (let i = 0; i < 6; i++) {
    const day = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    letters.add(ruleLetter(daily(day).rules) === 'S' && daily(day).rules.rockets === 0 ? 'N' : ruleLetter(daily(day).rules));
  }
  assert.equal(letters.size, 6);
  // UTC boundary: a local-evening Date still maps by UTC calendar date
  assert.equal(todayStr(new Date('2024-03-10T23:30:00-05:00')), '2024-03-11');
});

test('best comparator applies mode-specific tie-breaks', () => {
  // elimination: win first, then higher score, then fewer turns
  assert.equal(better('skirmish', { win: true, score: 10, turns: 20 }, { win: false, score: 999, turns: 1 }), true);
  assert.equal(better('skirmish', { win: true, score: 20, turns: 30 }, { win: true, score: 10, turns: 5 }), true);
  assert.equal(better('skirmish', { win: true, score: 10, turns: 4 }, { win: true, score: 10, turns: 9 }), true);
  // relay/rescue: win, then fewer rounds, then score
  assert.equal(better('relay', { win: true, rounds: 5, score: 1 }, { win: true, rounds: 9, score: 999 }), true);
  // operation: missions, then win, then score
  assert.equal(better('operation', { missions: 3, win: true, score: 1, rounds: 9 }, { missions: 2, win: false, score: 999, rounds: 1 }), true);
  assert.equal(better('skirmish', { win: false, score: 1 }, null), true, 'first record always stored');
});

test('storage adapter tolerates missing, corrupt, and throwing storage without breaking', () => {
  const mem = {};
  let warned = 0;
  const good = makeStore({ getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } }, () => warned++);
  assert.equal(good.get('x'), null, 'missing returns null');
  record(good, 'CODE', 'skirmish', { win: true, score: 50, turns: 10 });
  assert.equal(good.get('CODE').score, 50);
  // better attempt replaces
  record(good, 'CODE', 'skirmish', { win: true, score: 80, turns: 10 });
  assert.equal(good.get('CODE').score, 80);
  // worse attempt ignored
  record(good, 'CODE', 'skirmish', { win: false, score: 1 });
  assert.equal(good.get('CODE').score, 80);
  // corrupt entry replaced, not fatal
  mem.BAD = '{not json';
  assert.equal(good.get('BAD'), null);
  assert.ok(warned >= 1, 'corrupt read warned');
  // throwing storage
  const bad = makeStore({ getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } }, () => warned++);
  assert.equal(bad.get('x'), null);
  assert.equal(bad.set('x', 1), false);
  assert.equal(warned, 2, 'one warning per failing adapter');
});

test('corrupt record shapes cannot outrank valid attempts; operation keys distinct', () => {
  const mem = new Map();
  const store = makeStore({getItem:k=>mem.get(k),setItem:(k,v)=>mem.set(k,v)});
  const s = encodeCode({mode:'skirmish'},'same'), o = encodeCode({mode:'operation'},'same');
  assert.notEqual(s,o);
  for(const malformed of [{},[],{win:true,score:'9999'}, {win:true,score:10,turns:-1}]){
    mem.set(s,JSON.stringify(malformed));
    const attempt={win:false,score:2,turns:4};
    assert.deepEqual(record(store,s,'skirmish',attempt),attempt);
  }
  const d = daily('2024-01-05');
  assert.equal(d.rules.mode,'operation');
  assert.match(d.code,/^R7-1-O-/);
  assert.equal(better('operation',{missions:3,win:true,score:5,rounds:8},{missions:3,win:true,score:5,rounds:9}),true);
});

test('initial best reads reject corrupt shapes through the same storage boundary', () => {
  let value='{}';
  const store=storageAccess({getItem:()=>value,setItem:(_,v)=>value=v});
  for(const bad of [{},[],0,false,{win:true,score:10,turns:-1}]){
    value=JSON.stringify(bad);
    assert.equal(readBest(store,'code','skirmish'),null);
  }
  const good={win:true,score:10,turns:3};
  store('code',good);
  assert.deepEqual(readBest(store,'code','skirmish'),good);
});

test('failed writes never promote an unsaved best through either adapter', () => {
  const attempt={win:true,score:100,turns:3};
  for(const previous of [null,{win:false,score:10,turns:5}]){
    for(const wrapped of [false,true]){
      const warnings=[];
      let value=JSON.stringify(previous), writes=0;
      const storage={
        getItem:()=>value,
        setItem(){writes++;throw Error('quota');}
      };
      const store=(wrapped?makeStore:storageAccess)(storage,m=>warnings.push(m));
      assert.deepEqual((wrapped?record:updateBest)(store,'code','skirmish',attempt),previous);
      assert.deepEqual(JSON.parse(value),previous);
      assert.equal(writes,1);
      assert.match(warnings[0],/storage unavailable/i);
    }
  }
});

test('corrupt JSON warns accurately, remains replaceable, and does not hide later write failure', () => {
  for(const fails of [false,true]){
    let value='{broken';
    const warnings=[], attempt={win:true,score:40,turns:2};
    const store=storageAccess({
      getItem:()=>value,
      setItem:(_,v)=>{if(fails)throw Error('quota');value=v;}
    },m=>warnings.push(m));
    assert.equal(readBest(store,'code','skirmish'),null);
    assert.match(warnings[0],/corrupt.*ignored/i);
    assert.doesNotMatch(warnings[0],/unavailable|not.*saved/i);
    assert.deepEqual(updateBest(store,'code','skirmish',attempt),fails?null:attempt);
    if(fails)assert.match(warnings.at(-1),/storage unavailable/i);
    else {
      assert.deepEqual(readBest(store,'code','skirmish'),attempt);
      assert.ok(warnings.every(m=>/corrupt.*ignored/i.test(m)));
    }
  }
});

test('unavailable reads and writes warn once without reporting a saved record', () => {
  const warnings=[];
  const store=storageAccess({
    getItem(){throw new SyntaxError('storage denied, not corrupt JSON');},
    setItem(){throw Error('denied');}
  },m=>warnings.push(m));
  assert.equal(updateBest(store,'code','skirmish',{win:true,score:30,turns:2}),null);
  assert.equal(warnings.length,1);
  assert.match(warnings[0],/storage unavailable/i);
});

test('serialization and custom adapter errors are not swallowed or treated as successful writes', () => {
  const store=storageAccess({setItem(){assert.fail('must not write');}});
  const cyclic={};cyclic.self=cyclic;
  assert.throws(()=>store('code',cyclic),TypeError);
  const attempt={win:true,score:10,turns:1};
  assert.equal(updateBest((_,v)=>v?false:null,'code','skirmish',attempt),null);
  assert.throws(()=>record({get:()=>null,set(){throw Error('adapter');}},'code','skirmish',attempt),/adapter/);
});
