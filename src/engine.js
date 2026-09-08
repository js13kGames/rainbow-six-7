// Deterministic, DOM-free rules. Cell positions are linear grid indices.
export const W = 25, H = 17, CENTER = (H >> 1) * W + (W >> 1);
export const math=Math;
// weapon: [name, range, move]. Damage is 1 except Rocket (lethal radius 1).
export const weapons = { p: ['Pistol', 5, 5], r: ['Rifle', 6, 7], s: ['Sniper', 11, 5], R: ['Rocket', 10, 5] };
export const roleName = ['Charger', 'Flanker', 'Guardian'];
export const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
export const MODES = 'skirmish relay rescue deadline operation'.split(' ');
export const [SKIRMISH, RELAY, RESCUE, DEADLINE, OPERATION] = MODES;
export const [RECOVERY, RESUPPLY] = 'recovery resupply'.split(' ');
export const weaponMove = u => weapons[u.w][2];
export const marks='@U';
export const label = u => marks[u.team]+(u.id+1-u.team*6);
export const relayStatus = s => `${'-@U'[s.rt+1]} hold ${s.rn}/2`;
export const delta = (a,b) => [a%W-b%W,(a/W|0)-(b/W|0)];
export const distance = (a,b) => math.max(...delta(a,b)['map'](math.abs));
const solid = (s, p) => !s.map[p] || '#%'.includes(s.map[p]);
const step = (s,p,q) => {
  if(solid(s,q))return false;
  const [x,y]=delta(q,p);
  // Both callers take one neighbor step; only column wrapping needs rejection.
  return math.abs(x)<2 && (!x || !y || !solid(s,p+x) && !solid(s,p+y*W));
};
export const living = (s, team) => s.units.filter(u => u.hp > 0 && u.team === team);
export const actor = s => s.units[s.active];
export const at = (s, p) => s.units.find(u => u.hp > 0 && u.p === p);
const equip = (u, w) => { u.w = w; u.ammo = w === 'R' ? 2 : 0; };
export function log(s, text) {
  s.log=[text,...s.log].slice(0,60);
}
export const fail = message => { throw Error(message); };
export function normRules(r = {}) {
  const n = { v: 1, mode: SKIRMISH, rockets: 1, mission: 0, dl: r?.mode === DEADLINE ? 10 : 0 };
  const options = { v: [1], mode: MODES, rockets: [0, 1], mission: [0, 1, 2], dl: [0, 10] };
  if (!r || typeof r !== 'object' || ![null,Object.prototype].includes(Object.getPrototypeOf(r))) fail('Invalid rules/version');
  for (const k of Reflect.ownKeys(r)) {
    if (!Object.hasOwn(options, k) || !options[k].includes(r[k])) fail('Invalid rules/version');
    n[k] = r[k];
  }
  if (n.mode === DEADLINE && n.dl !== 10) fail('Invalid rules');
  return n;
}
export function reach(s, start, limit = 5, empty = false) {
  const paths = new Map([[start, [start]]]);
  // Map insertion order is the BFS queue; newly inserted entries are visited.
  for (const [p,path] of paths) {
    if (path.length > limit) continue;
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const next = p + y * W + x;
      if (paths.has(next) || !step(s,p,next) || !empty && at(s,next)) continue;
      paths.set(next, [...path, next]);
    }
  }
  return paths;
}
export const create = (seed, rules) => createGame(String(seed), normRules(rules));
// Internal entry: string seed and validated rules come from the challenge codec.
export function createGame(seed, R) {
  let rng = 2166136261;
  for (const c of seed + '|' + R.mode + R.rockets + R.dl) rng = math.imul(rng ^ c.charCodeAt(0), 16777619);
  const random = n => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) % n; };
  const s = { seed, rules: R, map: [], units: [], items: {}, active: 0, round: 1, result: '', log: [],
    stats: [0, 1]['map'](() => ({ score: 0, kills: 0, pickups: 0, shots: 0, hits: 0, turns: 0 })) };
  // Open odd columns and the central lane connect every random barrier pocket.
  for (let p = 0; p < W * H; p++) {
    const [x,y]=delta(p,0);
    s.map[p] = !x || x === W-1 || !y || y === H-1 ? '#'
      : x < 4 || x > W-5 || y === (H>>1) ? '.' : (x%2 ? '....+' : '..#%+')[random(5)];
  }
  const off = random(7);
  for (let id = 0; id < 13; id++) {
    const team=+(id>=6);
    s.units.push({id,team,p:(2+(id-team*6)*2)*W+2+(W-5)*team,
      hp:3,w:'p',moved:false,fired:false,used:false,ammo:0,role:team?[0,0,1,1,2,2,2][(id+off)%7]:0});
  }
  const kinds = 'rsR'.slice(0,2+R.rockets);
  const freeCols = s.map.flatMap((t, p) => t === '.' && p!==CENTER && p % W > 4 && p % W < W - 5 ? [p] : []);
  for (let n = 0; n < 2; n++) s.items[freeCols.splice(random(freeCols.length), 1)[0]] = kinds[random(kinds.length)];
  if (R.mode === RELAY) { s.relay = CENTER; s.rt = -1; s.rn = 0; }
  if (R.mode === RESCUE) {
    s.rescue = CENTER; s.carrier = -1; s.secured = false;
    s.extract = [...reach(s,s.rescue,999,true)].filter(([p])=>p%W===1)
      .sort((a,b)=>b[1].length-a[1].length||a[0]-b[0])[0][0];
  }
  return s;
}
// Center-to-center grid traversal; corner crossings check both side cells.
export function line(s, from, to) {
  const [x,y]=delta(to,from);
  const dx= math.abs(x), dy=math.abs(y), sx=math.sign(x), sy=math.sign(y)*W, path=[from];
  // Difference of the two integer boundary-crossing times; zero crosses both.
  let error=dy-dx;
  while(from!==to){
    const before=from, e=error;
    if(e<=0){from+=sx;error+=2*dy;}
    if(e>=0){from+=sy;error-=2*dx;}
    if(!step(s,before,from))return null;
    path.push(from);
  }
  return path;
}
// Read-only legality + outcome for firing at a target cell.
const failureText = ['used/dead', 'sniper moved', 'no ammo', 'ally/empty target', 'out of range', 'blocked sight'];
export function attackPreview(s, u, to) {
  const a = attack(s, u, to);
  return a.path ? { ...a, ok: true, cover: a.cover || undefined, dist: distance(u.p, to), ammo: a.rocket ? u.ammo-1 : 0,
    weapon: a.rocket && u.ammo===1 ? 'p' : u.w, damage: a.rocket ? 'lethal' : 1 }
    : {reason: ['used','moved','ammo','target','range','sight'][failureText.indexOf(a.reason)]};
}
// Shared legality/outcome kernel: rich public previews add display-only fields.
function trace(s, u, v) {
  const rocket = u.w === 'R';
  const invalid = !u.hp || u.used || u.fired ? 0 : u.w==='s' && u.moved ? 1
    : rocket && (!s.rules.rockets || u.ammo<1) ? 2 : !v?.hp || v.team===u.team ? 3
    : distance(u.p,v.p)>weapons[u.w][1] ? 4 : -1;
  const path = invalid<0 && line(s,u.p,v.p);
  if (!path) return {reason: failureText[invalid<0 ? 5 : invalid]};
  const cover = path.slice(1).find(p => s.map[p] === '+') || 0;
  return {path, cover, impact:cover || v.p, rocket};
}
export function attack(s, u, to) {
  const v=at(s,to), a=trace(s,u,v);
  if(!a.path)return a;
  const vic = a.cover ? [] : a.rocket ? s.units['map'](t=>t.id===u.id?u:t).filter(t => t.hp > 0 && distance(t.p, a.impact) <= 1) : [v];
  const friends = vic.filter(t => t.team === u.team).length;
  return { ...a, victims: vic['map'](t => t.id), friends, enemies: vic.length - friends };
}
export function shot(s, u, v) {
  if (!v) return null;
  const a = attackPreview(s, u, v.p);
  return a.ok ? a : null;
}
// Enemies that could immediately shoot a hypothetical unit at dest from where they stand.
export function threatsAt(s, u, dest) {
  return living(s, 1-u.team).flatMap(e => {
    const a = trace(s, {...e, used: false, fired:false}, {...u,p:dest});
    return a.path ? [{id:e.id, cover:!!a.cover}] : [];
  });
}
function collect(s, u, path) {
  const pickups = path.slice(1).filter(p => s.items[p]);
  for (const p of pickups) equip(u, s.items[p]);
  return pickups;
}
export function movePreview(s, u, dest) {
  const a=moveHint(s,u,dest);
  if(!a.path)return {reason:'range'};
  const sim={...u}, pickups=collect(s,sim,a.path);
  return {...a,ok:true,ammo:sim.ammo,pickups};
}
export function moveHint(s, u, dest) {
  const path = reach(s, u.p, weaponMove(u)).get(dest);
  if (!path) return {};
  const sim = { ...u, p: dest };
  collect(s, sim, path);
  return { steps: path.length - 1, path, weapon: sim.w, threats: threatsAt(s, sim, dest) };
}
export const results=['VICTORY','DEFEAT'];
function win(s, winner) {
  if (s.result) return;
  countTurn(s);
  s.result = results[winner];
  for (let t = 0; t < 2; t++) {
    const alive=living(s,t).length;
    s.stats[t].score += alive*50 + (alive && t===winner ? 200 : 0);
  }
  log(s, s.result);
}
function finish(s) {
  if (s.result || (living(s, 0).length && living(s, 1).length)) return;
  win(s, +!living(s, 0).length);
}
export function select(s, id, intermission = false) {
  const u = s.units[id], current = actor(s);
  if (!u || u.team || !u.hp || !intermission &&
    (s.result || u.used || current.moved && !current.used && id !== current.id)) return false;
  s.active = id; return true;
}
export function move(s, to) {
  const u = actor(s), path = reach(s, u.p, weaponMove(u)).get(to);
  if (s.result || u.moved || u.used || !u.hp || !path || path.length < 2) fail('Bad move');
  if(!s.rules.rockets && path.some(p=>s.items[p]==='R'))fail('No rockets');
  for (const p of collect(s,u,path)) {
    delete s.items[p];
    s.stats[u.team].score += 25; s.stats[u.team].pickups++;
  }
  u.p = to; u.moved = true;
  if (s.carrier === u.id) s.rescue = to;
  log(s, `${label(u)} move ${path.length - 1} ${u.w}`);
}
export function fire(s, to, confirmed = false) {
  const a=attackPreview(s,actor(s),to);
  commitShot(s,to,confirmed);
  return a;
}
export function commitShot(s, to, confirmed = false) {
  const u = actor(s), a = attack(s, u, to);
  if (s.result || !a.path) fail('Shot: ' + (a.reason || s.result));
  if (!u.team && a.rocket && !confirmed) fail('Confirm rocket');
  u.fired = u.moved = true;
  const st = s.stats[u.team]; st.shots++; st.hits += +(a.enemies>0);
  if (a.rocket) u.ammo--;
  if (a.cover) s.map[a.cover] = '.';
  else {
    for (const id of a.victims) {
      const t = s.units[id], amt = a.rocket ? t.hp : 1, sign = t.team === u.team ? -1 : 1;
      t.hp -= amt; st.score += sign * (10 * amt + (!t.hp ? 100 : 0));
      if (!t.hp && sign > 0) st.kills++;
      if (!t.hp && s.carrier === t.id) { s.carrier = -1; s.secured = false; s.rescue = t.p; }
    }
  }
  log(s,`${label(u)} ${a.cover?'cover destroyed':'hit '+a.victims['map'](i=>label(s.units[i])).join(' ')}`);
  if (a.rocket && u.ammo < 1) u.w = 'p';
  finish(s);
  return a;
}
export function interact(s) {
  const u = actor(s);
  if (!s.extract || s.result || !u.hp || u.team || u.used || u.fired) fail('No interaction');
  if (s.carrier === u.id) {
    if (u.p !== s.extract) fail('Go to E');
    win(s, 0);
  } else if (!s.secured && distance(u.p, s.rescue) <= 1) {
    s.secured = true; s.carrier = u.id; s.rescue = u.p; log(s, `${label(u)} secured the target.`);
  } else fail('Not adjacent');
  u.fired = u.moved = true;
}
export function end(s) {
  if (s.result) return;
  countTurn(s);
  finish(s);
  if (s.result) return;
  const n = s.units.find(u => u.hp > 0 && !u.used);
  if (n) { s.active = n.id; return; }
  if (s.relay) {
    const near = t => living(s,t).some(u=>distance(u.p,s.relay)<=1);
    const a=near(0), b=near(1), ctrl=a===b ? -1 : +b;
    s.rn=ctrl<0 ? 0 : ctrl===s.rt ? s.rn+1 : 1;
    s.rt=ctrl;
    log(s,'Relay '+relayStatus(s));
    if(s.rn>=2)return win(s,ctrl);
  }
  if(s.rules.dl && s.round>=s.rules.dl-1)return win(s,1);
  s.round++;
  for(const u of s.units)u.moved=u.fired=u.used=false;
  s.active=living(s,0)[0]?.id||0;
}
function countTurn(s) {
  const u = actor(s);
  if (!u.used) s.stats[u.team].turns++;
  u.used = true;
}
export function safe(s, u, v) {
  return safeAttack(s,u,attack(s,u,v.p));
}
function safeAttack(s,u,a) {
  return !!a.path && (!a.rocket || !!a.cover || a.enemies >= a.friends &&
    !(a.friends === living(s,u.team).length && a.enemies < living(s,1-u.team).length));
}
export function plan(s) {
  const actor = s.units[s.active], foes = living(s, 1 - actor.team);
  const routes = foes['map'](v => reach(s, v.p, 999, true));
  const obj=s.relay||(s.secured?s.extract:s.rescue)||CENTER;
  let best = { p: actor.p }, value = -Infinity;
  for (const [p, path] of reach(s, actor.p, weaponMove(actor))) {
    const u = { ...actor, p, moved: actor.moved || p !== actor.p };
    const pickups = collect(s,u,path).length;
    const nearest = math.min(...routes['map'](r => r.get(p)?.length || 999));
    let target, power = 0;
    for (const v of foes) {
      const a = attack(s, u, v.p);
      if (!safeAttack(s,u,a)) continue;
      const gain = a.cover ? 14 : 28+(3-v.hp)*4+20*a.rocket*(a.enemies-a.friends);
      if (gain > power) { power = gain; target = v.p; }
    }
    const score = u.role===2
      ? power*(distance(p,obj)<=2) + 4*(s.map[p]==='+') - math.max(0,distance(p,obj)-2)*10
      : power + pickups*9 - (actor.role===1 ? nearest+threatsAt(s,u,p).length*6 : nearest*3+(path.length-1)/10);
    if (score > value || score === value && p < best.p) { value = score; best = { p, target }; }
  }
  return best;
}
// ---- Operation campaign (deterministic three-mission wrapper) ----
const opRules = i => ({ v: 1, mode: MODES[i], rockets: 1, mission: 0, dl: i === 2 ? 10 : 0 });
export function startMission(op) {
  const s = createGame(op.seed + '#' + op.mission, opRules(op.mission));
  for (let i = 0; i < 6; i++) {
    const c = op.state.units[i], u = s.units[i];
    u.hp = c.hp; u.w = c.w; u.ammo = c.ammo;
  }
  s.active = living(s, 0)[0]?.id || 0;
  op.state = s; op.pending = false;
  return s;
}
export function createOperation(seed) {
  return createRun(String(seed), {mode: OPERATION});
}
export function createRun(seed, rules) {
  const campaign = rules.mode === OPERATION;
  const state = createGame(seed + (campaign ? '#0' : ''), campaign ? opRules(0) : rules);
  return { seed, campaign, mission: 0, score: 0, rounds: 0, state, inter: [], pending: false, done: false, win: false };
}
export function completeMission(op) {
  const s = op.state;
  if (!s.result || op.pending || op.done) return op;
  op.rounds += s.round;
  op.score += s.stats[0].score;
  const won=s.result===results[0] && living(s,0).length>0;
  op.done=!won || !op.campaign || op.mission>=2;
  op.win=won&&op.done;
  op.pending=!op.done;
  return op;
}
export function applyIntermission(op, choice, targetId, weapon) {
  if (!op.pending) fail('No intermission');
  if (choice === RECOVERY) for (const c of living(op.state,0)) c.hp = 3;
  else {
    const c = op.state.units[targetId];
    if (choice !== RESUPPLY || !c || c.team || !c.hp || !Object.hasOwn(weapons, weapon)) fail('Bad resupply');
    equip(c, weapon);
  }
  op.inter.push(choice);
  op.mission++;
  startMission(op);
  return op;
}
