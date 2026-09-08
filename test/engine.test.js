import { test } from 'node:test';
import assert from 'node:assert/strict';
import { W, H, weapons, weaponMove, create, normRules, reach, line, shot, attackPreview, movePreview, threatsAt, move, fire, end, select, interact, plan, safe, distance } from '../src/engine.js';

const cell = (x, y) => y * W + x;
function arena(rules) {
  const s = create('test', rules);
  s.map = s.map.map((_, p) => p % W && p % W < W - 1 && p >= W && p < W * (H - 1) ? '.' : '#');
  s.items = {};
  s.units.forEach((u, i) => { u.p = cell(i < 6 ? 2 : 20, 2 + i % 6 * 2); u.role = 0; });
  s.units[12].p = cell(21, 14);
  return s;
}

test('generation: 200 seeds connected floors, spaced 6/7 teams, 2 pickups, fixed roles', () => {
  for (let seed = 0; seed < 200; seed++) {
    const s = create(seed), cells = reach(s, s.units[0].p, 999, true);
    assert.equal(s.units.length, 13);
    assert.equal(s.units.filter(u => !u.team).length, 6);
    assert.equal(s.units.filter(u => u.team).length, 7);
    assert.ok(s.units.every(u => u.hp === 3 && u.w === 'p' && cells.has(u.p)));
    assert.equal(new Set(s.units.map(u => u.p)).size, 13);
    assert.equal(Object.keys(s.items).length, 2);
    assert.equal(cells.size, s.map.filter(t => !'#%'.includes(t)).length);
    const roles = s.units.slice(6).map(u => u.role);
    assert.equal(roles.filter(r => r === 0).length, 2);
    assert.equal(roles.filter(r => r === 1).length, 2);
    assert.equal(roles.filter(r => r === 2).length, 3);
  }
  assert.deepEqual(create('121'), create('121'));
  assert.notDeepEqual(create(121).map, create(122).map);
});

test('rules: normalize, default skirmish, reject unknown version, differing rules differ', () => {
  assert.deepEqual(normRules(), { v: 1, mode: 'skirmish', rockets: 1, mission: 0, dl: 0 });
  assert.equal(normRules({ mode: 'deadline' }).dl, 10);
  for (const rules of [{ mode: 'bogus' }, { rockets: 2 }, { mission: -1 }, { mission: 3 },
    { mission: 0.5 }, { dl: 9 }, { extra: 1 }, { v: null }, { rockets: false },
    [], null, new Date(), {[Symbol('unknown')]:1}])
    assert.throws(() => normRules(rules), /rules|version/i);
  assert.throws(() => normRules({ v: 2 }), /version/);
  assert.deepEqual(create('s', { mode: 'relay' }), create('s', { mode: 'relay' }));
  assert.notDeepEqual(create('s', { rockets: 1 }).map, create('s', { rockets: 0 }).map);
  const nr = create('s', { rockets: 0 });
  assert.ok(!Object.values(nr.items).includes('R'));
});

test('activation: any unused soldier selectable; each once; dead/used rejected; then all seven AI; round reset', () => {
  const s = arena();
  assert.ok(select(s, 3));
  assert.equal(s.active, 3);
  s.units[1].hp = 0;
  assert.ok(!select(s, 1), 'dead not selectable');
  select(s, 0); end(s);
  assert.ok(!select(s, 0), 'used not selectable');
  assert.equal(s.active, 2, 'auto-advance skips dead/used');
  // burn through remaining soldiers 2..5
  for (const id of [2, 3, 4, 5]) { select(s, id); end(s); }
  assert.equal(s.units[s.active].team, 1, 'unicorn phase after soldiers used');
  for (let i = 0; i < 7; i++) end(s);
  assert.equal(s.round, 2);
  assert.ok(s.units.every(u => !u.used && !u.moved && !u.fired));
  assert.equal(s.active, 0, 'default lowest living soldier');
});

test('weapons: ranges, moves, stationary sniper, two rockets and pistol fallback', () => {
  assert.deepEqual(Object.values(weapons).map(w => w[1]), [5, 6, 11, 10]);
  assert.deepEqual([weaponMove({ w: 'p' }), weaponMove({ w: 'r' }), weaponMove({ w: 's' }), weaponMove({ w: 'R' })], [5, 7, 5, 5]);
  const s = arena(), u = s.units[0], v = s.units[6];
  u.w = 'r'; v.p = cell(8, 2); assert.ok(shot(s, u, v)); v.p = cell(9, 2); assert.equal(shot(s, u, v), null);
  // sniper
  u.w = 's'; v.p = cell(13, 2); assert.ok(shot(s, u, v));
  u.moved = true; assert.equal(attackPreview(s, u, v.p).reason, 'moved');
  u.moved = false;
  // rifle mobility: move up to 7
  assert.ok(reach(s, u.p, weaponMove({ w: 'r' })).has(cell(9, 2)));
  // rocket ammo + fallback
  u.w = 'R'; u.ammo = 2; v.p = cell(6, 2);
  fire(s, v.p, true); assert.equal(u.ammo, 1); assert.equal(u.w, 'R');
  u.fired = u.moved = false; s.units[7].p = cell(6, 2);
  fire(s, cell(6, 2), true); assert.equal(u.ammo, 0); assert.equal(u.w, 'p', 'fallback to pistol at zero ammo');
});

test('selection locks once movement starts, and dead shooters have no legal preview', () => {
  const s = arena();
  select(s, 3);
  move(s, cell(3, 8));
  assert.equal(select(s, 0), false);
  assert.equal(s.active, 3);
  end(s);
  assert.equal(select(s, 0), true);
  s.units[0].hp = 0;
  assert.equal(attackPreview(s, s.units[0], s.units[6].p).ok, undefined);
});

test('movement and sight share corner blocking; shooter cover is not interception', () => {
  const s=arena(),u=s.units[0],v=s.units[6];
  s.map[cell(3,2)]='#';
  assert.equal(line(s,u.p,cell(3,3)),null);
  assert.equal(reach(s,u.p,1).has(cell(3,3)),false);
  s.map[cell(3,2)]='.';
  assert.ok(line(s,u.p,cell(3,3)));
  s.map[u.p]='+';
  v.p=cell(6,2);
  fire(s,v.p);
  assert.equal(v.hp,2);
  assert.equal(s.map[u.p],'+');
  s.map[cell(2,3)]='#';
  assert.deepEqual(line(s,u.p,cell(5,4)),[cell(2,2),cell(3,2),cell(3,3),cell(4,3),cell(4,4),cell(5,4)],
    'supercover visits crossed cells, not an un-crossed side cell');
  const open={map:Array(W*H).fill('.'),units:[]};
  assert.deepEqual([...reach(open,W,1,true).keys()].sort((a,b)=>a-b),[0,1,W,W+1,2*W,2*W+1],
    'open borders still cannot wrap columns');
});

test('objective victory awards the victory bonus only to the winner', () => {
  const s=arena({mode:'rescue'});
  s.carrier=0;s.secured=true;s.units[0].p=s.extract;
  interact(s);
  assert.equal(s.stats[0].score,6*50+200);
  assert.equal(s.stats[1].score,7*50);
});

test('pickups: crossing equips and sets rocket ammo; no-rockets never generates rockets', () => {
  const s = arena(); const u = s.units[0];
  s.items[reach(s, u.p).get(cell(4, 2))[1]] = 'R';
  move(s, cell(4, 2));
  assert.equal(u.w, 'R'); assert.equal(u.ammo, 2); assert.equal(s.stats[0].pickups, 1);
  for (let seed = 0; seed < 200; seed++) assert.ok(!Object.values(create(seed, { rockets: 0 }).items).includes('R'));
});

test('attackPreview is read-only with exact victims for ordinary, cover, friendly, and rocket cases', () => {
  const s = arena(), u = s.units[0], v = s.units[6], ally = s.units[1];
  v.p = cell(6, 2);
  const before = structuredClone(s);
  const a = attackPreview(s, u, v.p);
  assert.deepEqual(s, before, 'read-only');
  assert.equal(a.ok, true); assert.deepEqual(a.victims, [6]); assert.equal(a.enemies, 1);
  // cover interception
  s.map[cell(4, 2)] = '+';
  const c = attackPreview(s, u, v.p);
  assert.equal(c.cover, cell(4, 2)); assert.deepEqual(c.victims, []);
  s.map[cell(4, 2)] = '.';
  // rocket splash counts friendly + enemy
  u.w = 'R'; u.ammo = 2; ally.p = cell(6, 3);
  const r = attackPreview(s, u, v.p);
  assert.equal(r.enemies, 1); assert.equal(r.friends, 1); assert.deepEqual(r.victims.sort(), [1, 6]);
  // illegal reasons
  u.w = 'p';
  assert.equal(attackPreview(s, u, cell(1, 1)).reason, 'target');
  u.w = 'R'; u.ammo = 0; assert.equal(attackPreview(s, u, v.p).reason, 'ammo');
});

test('movePreview and threatsAt report crossed pickups, final weapon, and current-position threats only', () => {
  const s = arena(), u = s.units[0], e = s.units[6];
  s.items[cell(4, 2)] = 's';
  const mp = movePreview(s, u, cell(4, 2));
  assert.equal(mp.weapon, 's'); assert.deepEqual(mp.pickups, [cell(4, 2)]); assert.equal(mp.steps, 2);
  // an enemy rifleman in range threatens the destination
  e.w = 'r'; e.p = cell(9, 2);
  const th = threatsAt(s, u, cell(4, 2));
  assert.ok(th.some(t => t.id === 6));
  // a moved sniper poses no immediate threat
  e.w = 's'; e.moved = true;
  assert.ok(!threatsAt(s, u, cell(4, 2)).some(t => t.id === 6));
});

test('roles: Charger closes, Flanker prefers low-threat lane, Guardian holds objective', () => {
  // Charger with no shot minimizes distance to nearest soldier
  let s = arena(); s.units.forEach(t => t.hp = 0);
  const c = s.units[6], sol = s.units[0]; c.hp = sol.hp = 3; c.role = 0; s.active = 6;
  c.p = cell(14, 8); sol.p = cell(4, 8);
  const before = structuredClone(s), a = plan(s);
  assert.deepEqual(s, before, 'plan is read-only');
  assert.ok(distance(a.p, sol.p) < distance(c.p, sol.p), 'charger advances');
  // Guardian stays near relay objective
  s = arena({ mode: 'relay' });
  s.units.forEach(t => t.hp = 0);
  const g = s.units[6]; g.hp = 3; g.role = 2; s.active = 6;
  s.units[0].hp = 3; s.units[0].p = cell(2, 2);
  s.relay = cell(12, 8); g.p = cell(12, 8);
  const gp = plan(s);
  assert.ok(distance(gp.p, s.relay) <= 2, 'guardian holds within radius 2');
});

test('relay: sole control, contest reset, control switch, two-hold win, elimination precedence', () => {
  const s = arena({ mode: 'relay' });
  s.relay = cell(12, 8); s.rt = -1; s.rn = 0;
  s.units.forEach(u => u.hp = 0);
  const a = s.units[0], b = s.units[6]; a.hp = b.hp = 3;
  a.p = cell(12, 8); b.p = cell(2, 2);
  // simulate a completed round: everyone used
  // drive rounds manually via resolveRound-like: mark all used then advance through end
  const complete = () => { for (const u of s.units) if (u.hp) { s.active = u.id; u.used = false; end(s); } };
  complete();
  assert.equal(s.rt, 0); assert.equal(s.rn, 1);
  // contest clears
  b.p = cell(12, 9); complete();
  assert.equal(s.rn, 0); assert.equal(s.rt, -1);
  // switch to unicorn control
  a.p = cell(2, 2); complete();
  assert.equal(s.rt, 1); assert.equal(s.rn, 1);
  complete();
  assert.equal(s.result, 'DEFEAT', 'two consecutive unicorn holds win for U');
});

test('rescue: secure, carry, drop on death, resecure, extract victory; enemy ignores target', () => {
  const s = arena({ mode: 'rescue' });
  s.rescue = cell(10, 8); s.carrier = -1; s.secured = false; s.extract = cell(1, 8);
  const u = s.units[0]; u.p = cell(9, 8); s.active = 0;
  assert.throws(() => fire(s, cell(10, 8)), /target/i);
  interact(s);
  assert.equal(s.secured, true); assert.equal(s.carrier, 0);
  end(s);
  u.used = false; u.moved = false; select(s, 0);
  move(s, cell(8, 8));
  assert.equal(s.rescue, cell(8, 8), 'target follows carrier');
  // carrier dies -> drop
  const e = s.units[6]; e.hp = 3; e.p = cell(8, 9); e.w = 'p'; s.active = 6; e.used = false;
  u.hp = 1;
  fire(s, cell(8, 8));
  assert.equal(u.hp, 0);
  assert.equal(s.carrier,-1); assert.equal(s.secured,false); assert.equal(s.rescue,cell(8,8));
  s.active=1; s.units[1].p=cell(7,8);
  interact(s); assert.equal(s.carrier,1,'another soldier resecures actual drop');
  // extract
  const c = arena({ mode: 'rescue' });
  c.rescue = cell(2, 8); c.extract = cell(1, 8); c.secured = true; c.carrier = 0;
  c.units[0].p = cell(1, 8); c.active = 0;
  interact(c);
  assert.equal(c.result, 'VICTORY');
});

test('deadline: round-9 final win valid; round-10 transition is defeat', () => {
  const s = arena({ mode: 'deadline' });
  assert.equal(s.rules.dl, 10);
  s.round = 9;
  s.units.forEach(u => { if (u.team) u.hp = 0; });
  // last soldier action wins by elimination before deadline resolves
  s.units.slice(6).forEach(u => u.hp = 0);
  select(s, 0); end(s);
  assert.equal(s.result, 'VICTORY');
  const t = arena({ mode: 'deadline' });
  t.round = 9;
  for (const u of t.units) { t.active = u.id; u.used = false; if (u.hp) end(t); }
  assert.equal(t.result, 'DEFEAT', 'reaching round 10 loses');
});

test('failed actions preserve full state; ranges/endpoint cover; AI stays legal and safe over seeds', () => {
  const s = arena(), u = s.units[0], v = s.units[6];
  v.p = cell(6, 2); s.map[v.p] = '+';
  fire(s, v.p);
  assert.equal(v.hp, 3, 'endpoint cover absorbs'); assert.equal(s.map[v.p], '.');
  const after = structuredClone(s);
  assert.throws(() => fire(s, v.p));
  assert.deepEqual(s, after);
  assert.throws(() => move(s, cell(9, 2)), /move/i);
  for (let seed = 0; seed < 30; seed++) {
    const g = create(seed);
    for (let n = 0; n < 40 && !g.result; n++) {
      const actor = g.units[g.active], a = plan(g);
      if (a.p !== actor.p) move(g, a.p);
      if (a.target !== undefined) {
        const tv = g.units.find(x => x.hp && x.p === a.target);
        assert.ok(shot(g, actor, tv), `seed ${seed} ${actor.w}`);
        assert.ok(safe(g, actor, tv));
        fire(g, a.target, true);
      }
      end(g);
    }
  }
});

test('AI engages idle squad through connected terrain (40 seeds)', () => {
  for (let seed = 0; seed < 40; seed++) {
    const s = create(seed);
    while (!s.result && s.round < 40) {
      const u = s.units[s.active];
      if (u.team) { const a = plan(s); if (a.p !== u.p) move(s, a.p); if (a.target !== undefined) fire(s, a.target, true); }
      end(s);
    }
    assert.equal(s.result, 'DEFEAT', `seed ${seed}`);
    assert.ok(s.stats[1].shots > 0);
  }
});

test('rockets require enemy target; cover suppresses all collateral', () => {
  const s = arena(), u = s.units[0];
  u.w = 'R'; u.ammo = 2;
  for (const to of [cell(3, 2), s.units[1].p]) {
    const before = structuredClone(s);
    assert.equal(attackPreview(s, u, to).reason, 'target');
    assert.throws(() => fire(s, to, true));
    assert.deepEqual(s, before);
  }
  s.units[6].p = cell(6, 2); s.map[cell(4, 2)] = '+';
  assert.deepEqual(fire(s, s.units[6].p, true).victims, []);
  assert.equal(u.ammo, 1);
});

test('terminating fire, interact and end count exactly once', () => {
  for (const action of ['fire', 'interact', 'end']) {
    const s = arena({ mode: 'rescue' });
    if (action === 'interact') {
      s.carrier = 0; s.units[0].p = s.extract;
      interact(s);
    } else {
      s.units.slice(6).forEach(u => u.hp = 0);
      if (action === 'fire') {
        s.units[6].hp = 1; s.units[6].p = cell(3, 2);
        fire(s, s.units[6].p);
      } else end(s);
    }
    assert.equal(s.result, 'VICTORY');
    assert.equal(s.stats[0].turns, 1, action);
    end(s); end(s);
    assert.equal(s.stats[0].turns, 1);
  }
});

test('no rockets rejects imported weapon and pickups without mutation', () => {
  const s=arena({rockets:0}),u=s.units[0];
  u.w='R';u.ammo=2;s.units[6].p=cell(6,2);
  let before=structuredClone(s);
  assert.throws(()=>fire(s,s.units[6].p,true));
  assert.deepEqual(s,before);
  u.w='p';s.items[cell(4,2)]='R';before=structuredClone(s);
  assert.throws(()=>move(s,cell(4,2)));
  assert.deepEqual(s,before);
});

test('flanker chooses a damaging rifle lane outside immediate pistol threats', () => {
  const s=arena();
  s.units.forEach(u=>u.hp=0);
  const u=s.units[6],v=s.units[0];
  u.hp=v.hp=3;u.role=1;u.w='r';u.p=cell(14,8);v.p=cell(4,8);s.active=6;
  const before=structuredClone(s),a=plan(s);
  assert.equal(a.target,v.p);
  assert.equal(threatsAt(s,u,a.p).length,0);
  assert.ok(distance(a.p,v.p)<=6);
  assert.deepEqual(plan(s),a);
  assert.deepEqual(s,before);
});

test('rocket preview gives ammo fallback and actual mutual wipe is defeat', () => {
  const s=arena(),u=s.units[0],v=s.units[6];
  s.units.forEach(t=>t.hp=0);u.hp=v.hp=3;
  u.w='R';u.ammo=1;v.p=cell(3,2);
  const a=attackPreview(s,u,v.p);
  assert.equal(a.ammo,0);assert.equal(a.weapon,'p');assert.equal(a.damage,'lethal');
  assert.deepEqual(a.victims,[0,6]);
  fire(s,v.p,true);
  assert.equal(s.result,'DEFEAT');
  assert.equal(s.stats[0].turns,1);
});
