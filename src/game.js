import { W, math, weapons, roleName, marks, label, relayStatus, results, delta, distance, attack as attackPreview, moveHint as movePreview, move, commitShot as fire, end, select, interact, plan, log, createRun, completeMission, applyIntermission, actor, at, living, OPERATION, RECOVERY, RESUPPLY } from './engine.js';
import { CODES, ruleFromLetter, encodePreset, decodePreset, dailyCode, storageAccess, readBest, updateBest as record } from './meta.js';

const doc=document, ui={};
const text = (id, value) => ui[id].textContent = value;
const attr = (node, name, value) => node.setAttribute(name, value);
function node(tag,id,content='',parent=doc.body){
  const e=doc.createElement(tag);e['id']=id;e.textContent=content;parent.append(e);return ui[id]=e;
}
function field(id,values){
  const e=node(values?'select':'input',id,'',node('label','',id));
  if(values)e.innerHTML=values['map'](([k,v])=>`<option value=${k}>${v}</option>`).join('');
  return e;
}
const names='N:New|Daily UTC|Load|Copy|H:Help|F:Aim|E:Interact|Space:End|Recovery 3HP|Resupply one'.split('|');
const buttons = {
  n:()=>begin(encodePreset(modeInput.value,seedInput.value||math.random().toString(36))),
  daily:()=>begin(dailyCode()),
  load:()=>begin(codeInput.value),
  copy:()=>{
    codeInput.value=code;
    navigator.clipboard?.writeText(code).catch(()=>codeInput.select())||codeInput.select();
  },
  h:()=>alert(`Arrows/WASD cursor
Enter act
Q/Shift-Q unit
Tab target
Shift-Tab exit
Esc cancel
Move once;fire/end
Name/range/move
Sniper stationary
Rockets 2 then pistol; radius1 kills allies`),
  f:()=>{aim=!aim;cursor=targets()[0]?.p||actor(s).p;},
  e:()=>queue(interact),
  ' ':()=>{aim=false;queue(end);},
  [RECOVERY]:()=>next(RECOVERY),
  [RESUPPLY]:()=>next(RESUPPLY)
};
node('h1','',doc.title);
const modeInput=field('mode',[...CODES]['map'](k=>[k,k==='N'?'no-rockets':ruleFromLetter(k).mode]));
const seedInput=field('seed'), codeInput=field('code');
seedInput.maxLength=40;codeInput.maxLength=222;
Object.entries(buttons).forEach(([k,action],i)=>{
  node('button',k,names[i]).onclick=()=>{
    try{action();}catch(e){log(s,e.message);}
    render();if(['f','e',' '].includes(k))board.focus();
  };
});
field('weapon',Object.entries(weapons)['map'](([k,w])=>[k,w[0]]));
for(const k of ['contrast','motion'])field(k).type='checkbox';
const board=node('div','board');
board.tabIndex=0;
attr(board,'role','grid');attr(board,'aria-label','Map');attr(board,'aria-describedby','info');
for(const k of ['info','status','log','warn'])attr(node('pre',k),'role',k==='warn'?'alert':k==='log'?'log':'status');
const xy=p=>delta(p,0).join(',');
const palette='f67 fb6 fe6 7e9 8cf daf'.split(' ');
const unit=u=>`${label(u)} ${u.team?roleName[u.role]:''} ${u.hp}HP ${weapons[u.w].join('/')}${u.ammo?' ammo'+u.ammo:''}${u.used?' used':''}`;
let s,op,code,cursor,aim,busy,epoch=0,effect=[],warned,best;
const store=storageAccess(null,message=>warned=message);
const player=()=>!busy&&!s.result&&s.active<6;
const targets=()=>living(s,1).filter(v=>attackPreview(s,actor(s),v.p).path);
const attackText=a=>!a.path?a.reason:a.cover?`cover ${xy(a.cover)} absorbs`:
  a.victims['map'](i=>(s.units[i].team?'enemy ':'ally ')+label(s.units[i])).join(', ');
function render(){
  const u=actor(s), mp=player()&&!aim&&!u.moved?movePreview(s,u,cursor):{}, a=attackPreview(s,u,cursor);
  board.innerHTML=s.map['map']((_,p)=>{
    const v=at(s,p), glyph=v?marks[v.team]:p===s.relay?'&':p===s.extract?'E':p===s.rescue&&s.carrier<0?'?':s.items[p]||s.map[p];
    const name=xy(p)+' '+(v?unit(v):s.items[p]?weapons[glyph].join('/'):glyph);
    const cls=[p===cursor?'c':'',v===u?'a':'',v?.used?'u':'',mp.threats?.some(t=>t.id===v?.id)?'t':''].join(' ');
    return (p%W?'':'<div role=row>')+`<b id=c${p} role=gridcell style=color:#${palette[v?.id]||'fff'} title="${name}" aria-label="${name}" class="${cls}">${effect.length&&distance(p,effect[0])<=effect[1]?effect[1]?'X':'*':!v&&glyph==='.'&&mp.path?.includes(p)?':':glyph}</b>`+(p%W===W-1?'</div>':'');
  }).join('');
  attr(board,'aria-activedescendant','c'+cursor);
  text('info',`${unit(u)} ${aim?'AIM':'MOVE'}: `+
    (aim||at(s,cursor)?.team?attackText(a):mp.path?`${mp.steps} steps -> ${mp.weapon}; Threats: ${mp.threats.length} ${mp.threats['map'](t=>label(s.units[t.id])+(t.cover?' cover':'')).join(' ')}`:'unreachable'));
  text('status',[
    `${s.rules.mode} round ${s.round} ${s.result}`,
    op.campaign?`Operation ${op.mission+1}/3 ${op.score}pts ${op.rounds} rounds ${op.pending?'Choose one':op.done?results[+!op.win]:''}`:'',
    s.relay?`Relay ${xy(s.relay)} ${relayStatus(s)}`:'',
    s.extract?`? ${s.carrier<0?xy(s.rescue):label(s.units[s.carrier])} -> E ${xy(s.extract)}; Interact`:'',
    s.rules.dl?`Deadline: ${s.rules.dl-s.round} rounds left`:'',
    // Bounded 0..100 percentages; the integer cast also maps zero-shot NaN to 0.
    ...s.stats['map']((t,i)=>`${marks[i]} ${t.score}pts ${living(s,i).length} alive ${t.kills} kills ${t.turns} turns ${100*t.hits/t.shots+.5|0}%`),
    best?`Local best ${results[+!best.win]} ${best.score}pts ${best.rounds} rounds ${best.turns} turns`:''
  ].filter(Boolean).join('\n'));
  text('log',s.log.join('\n'));
  text('warn',warned||'');
  for(const k of ['f','e',' '])ui[k].disabled=!player();
  for(const k of [RECOVERY,RESUPPLY,'weapon'])ui[k].disabled=!op.pending;
  text('n',op.campaign?'N:Restart operation':names[0]);
}
const wait=ms=>new Promise(r=>setTimeout(r,ui.motion.checked||matchMedia('(prefers-reduced-motion:reduce)').matches?0:ms));
function shoot(state,to){
  if(to===undefined)return;
  const a=fire(state,to,true);
  effect=[a.impact,a.rocket&&!a.cover];
}
async function queue(action,to){
  if(!player())return;
  const ticket=epoch;busy=true;render();
  try{
    for(let ai=false;;ai=true){
      action(s,to);render();await wait(180);
      if(ticket!==epoch)return;
      effect=[];
      if(ai||actor(s).fired)end(s);
      if(s.result||s.active<6)break;
      const a=plan(s);log(s,unit(actor(s)));
      if(a.p!==actor(s).p)move(s,a.p);
      cursor=actor(s).p;
      action=shoot;to=a.target;
    }
    cursor=actor(s).p;
    if(s.result){
      completeMission(op);
      if(op.pending)pick(living(s,0)[0].id);
      if(!op.pending)best=record(store,code,op.campaign?OPERATION:s.rules.mode,{
        win:op.win,score:op.score,rounds:op.rounds,turns:s.stats[0].turns,missions:op.win?3:op.mission
      });
    }
  }catch(e){if(ticket===epoch){log(s,e.message);if(s.active>5)s.result='ERROR: restart';}}
  finally{if(ticket===epoch){busy=false;effect=[];render();}}
}
function pick(id){if((player()||op.pending)&&select(s,id,op.pending)){cursor=actor(s).p;aim=false;render();return true;}}
function act(){
  if(op.pending)return pick(at(s,cursor)?.id);
  if(!player())return;
  const to=cursor,v=at(s,to);
  if(v&&!v.team&&!aim)return pick(v.id);
  if(aim||v){
    const a=attackPreview(s,actor(s),to),ticket=epoch;
    if(!a.path){log(s,a.reason);render();return;}
    if(a.rocket&&!confirm('ROCKET: '+attackText(a)+'. Fire?'))return;
    if(ticket===epoch)queue(shoot,to);
  }else queue(move,to);
}
function reset(){epoch++;busy=aim=false;effect=[];cursor=actor(s).p;render();board.focus();}
function begin(value){
  value=value.trim();
  const d=decodePreset(value);
  if(!d){log(s,'Invalid code');return;}
  const {rules:r,seed}=d;
  code=value;op=createRun(seed,r);s=op.state;
  best=readBest(store,code,r.mode);codeInput.value=code;seedInput.value=seed;modeInput.value=code[5];reset();
}
function next(choice){
  applyIntermission(op,choice,s.active,ui['weapon'].value);s=op.state;reset();
}
board.onclick=board.onpointermove=e=>{
  const id=e['target']['id'];
  if(busy||!/^c\d+$/.test(id))return;
  const p=+id.slice(1);
  if(e.type==='click'&&(player()||op.pending)){cursor=p;board.focus();act();}
  else if(cursor!==p){cursor=p;render();}
};
doc.onkeydown=e=>{
  if(/INPUT|SELECT/.test(e['target'].tagName))return;
  const k=e.key.toLowerCase(),steps={arrowleft:-1,a:-1,arrowright:1,d:1,arrowup:-W,w:-W,arrowdown:W,s:W},ts=targets();
  if(e['target']!==board&&!/^[nh]$/.test(k)||k==='tab'&&(e.shiftKey||!ts.length))return;
  if(!(steps[k]||buttons[k]||/^(enter|q|tab|escape)$/.test(k)))return;
  e.preventDefault();
  if(buttons[k])return ui[k].click();
  if(busy)return;
  const dest=cursor+steps[k];
  if(s.map[dest]&&distance(cursor,dest)===1)cursor=dest;
  if(k==='q'&&(player()||op.pending)){
    let id=s.active;
    do{id=(id+(e.shiftKey?5:1))%6;}while(!pick(id));
  }
  if(k==='tab')cursor=ts[(ts.findIndex(u=>u.p===cursor)+1)%ts.length].p;
  if(k==='escape'){aim=false;cursor=actor(s).p;}
  if(k==='enter')act();
  render();
};
ui.n.click();
