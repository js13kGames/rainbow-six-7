import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOperation, startMission, completeMission, applyIntermission } from '../src/engine.js';

test('operation: three derived seeds, fixed mission modes, deterministic', () => {
  const a = createOperation('op1'), b = createOperation('op1');
  assert.equal(a.state.rules.mode, 'skirmish');
  assert.deepEqual(a.state.map, b.state.map);
  // advance to relay and rescue+deadline
  a.state.units.slice(6).forEach(u => u.hp = 0); // win mission 1
  a.state.result = 'VICTORY';
  completeMission(a);
  applyIntermission(a, 'recovery');
  assert.equal(a.state.rules.mode, 'relay');
  assert.equal(a.mission, 1);
  a.state.units.slice(6).forEach(u => u.hp = 0); a.state.result = 'VICTORY';
  completeMission(a);
  applyIntermission(a, 'recovery');
  assert.equal(a.state.rules.mode, 'rescue');
  assert.equal(a.state.rules.dl, 10);
});

test('operation: survivors carry HP/weapon/ammo, dead stay dead, map/enemies reset', () => {
  const op = createOperation('carry');
  const s = op.state;
  // set up survivors with distinct state, kill soldier 5 and all enemies
  s.units[0].hp = 1;
  s.units[1].w = 'r';
  s.units[2].w = 'R'; s.units[2].ammo = 2;
  s.units[5].hp = 0;
  s.units.slice(6).forEach(u => u.hp = 0);
  s.result = 'VICTORY';
  completeMission(op);
  applyIntermission(op, 'recovery'); // restores HP to 3 for survivors
  const n = op.state;
  assert.equal(n.units[0].hp, 3, 'recovery heals');
  assert.equal(n.units[1].w, 'r', 'weapon carried');
  assert.equal(n.units[2].w, 'R'); assert.equal(n.units[2].ammo, 2, 'ammo carried');
  assert.equal(n.units[5].hp, 0, 'dead stays dead');
  assert.ok(n.units.slice(6).every(u => u.hp === 3), 'enemies reset for new mission');
  assert.notEqual(n.round, undefined); assert.equal(n.round, 1);
});

test('operation: resupply changes exactly one survivor equipment only; intermission once', () => {
  const op = createOperation('re');
  op.state.units.slice(6).forEach(u => u.hp = 0); op.state.result = 'VICTORY';
  op.state.units[0].hp = 2;
  completeMission(op);
  applyIntermission(op, 'resupply', 3, 's');
  const n = op.state;
  assert.equal(n.units[3].w, 's', 'chosen survivor re-equipped');
  assert.equal(n.units[0].hp, 2, 'HP unchanged by resupply');
  assert.equal(n.units[0].w, 'p', 'others unchanged');
  assert.throws(() => applyIntermission(op, 'recovery'), /No intermission/);
});

test('operation: full wipe ends operation; mission 3 win wins; restart cannot resurrect', () => {
  const op = createOperation('wipe');
  op.state.units.forEach(u => { if (!u.team) u.hp = 0; }); // squad wiped
  op.state.result = 'DEFEAT';
  completeMission(op);
  assert.equal(op.done, true); assert.equal(op.win, false);

  const w = createOperation('final');
  // fast-forward to mission 3
  for (let m = 0; m < 2; m++) {
    w.state.units.slice(6).forEach(u => u.hp = 0); w.state.result = 'VICTORY';
    completeMission(w); applyIntermission(w, 'recovery');
  }
  assert.equal(w.mission, 2);
  w.state.units[4].hp = 0; // one casualty carried
  w.state.units.slice(6).forEach(u => u.hp = 0); w.state.result = 'VICTORY';
  completeMission(w);
  assert.equal(w.done, true); assert.equal(w.win, true);
  // restart the mission would not resurrect soldier 4
  startMission(w);
  assert.equal(w.state.units[4].hp, 0);
});

test('operation aggregates rounds exactly once and skips dead initial selection', () => {
  const op = createOperation('rounds');
  for (let i = 0; i < 3; i++) {
    op.state.round = i + 2;
    op.state.units[0].hp = 0;
    op.state.result = 'VICTORY';
    completeMission(op);
    const before = structuredClone(op);
    completeMission(op);
    assert.deepEqual(op, before);
    if (i < 2) {
      applyIntermission(op, 'resupply', 1, 'r');
      assert.equal(op.state.active, 1);
    }
  }
  assert.equal(op.rounds, 9);
});

test('operation rejects invalid intermissions; squad wipe overrides supplied victory', () => {
  const op=createOperation('invalid');
  const before=structuredClone(op);
  assert.throws(()=>applyIntermission(op,'recovery'));
  assert.deepEqual(op,before);
  op.state.result='VICTORY';completeMission(op);
  for(const args of [['other',0,'r'],['resupply',99,'r'],['resupply',0,'constructor']]){
    const copy=structuredClone(op);
    assert.throws(()=>applyIntermission(op,...args));
    assert.deepEqual(op,copy);
  }
  const wipe=createOperation('mutual');
  wipe.state.units.forEach(u=>u.hp=0);wipe.state.result='VICTORY';
  completeMission(wipe);
  assert.equal(wipe.done,true);assert.equal(wipe.win,false);
});
