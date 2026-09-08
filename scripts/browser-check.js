// Run with Playwright MCP browser_run_code_unsafe against the built HTML.
// A separate context protects user storage. The source engine is an oracle;
// only clicks/keys change the actual minified game, including all three missions.
async page => {
  const url=page.url(), context=await page.context().browser().newContext();
  page=await context.newPage();
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const click=id=>page.locator(`[id="${id}"]`).click();
  const settle=()=>page.clock.runFor(5000);
  const board=()=>page.locator('#board');
  const soldier=id=>page.getByRole('gridcell',{name:new RegExp('@'+(id+1)+' ')});
  const info=()=>page.locator('#info').innerText();
  const labels=()=>page.locator('[role=gridcell]').evaluateAll(cs=>cs.map(c=>c.getAttribute('aria-label')));
  let cancel=false, dialogs=[], errors=[], rockets=0, covers=0, threats=0, healed=false;
  page.on('dialog',async d=>{dialogs.push(d.message());await(cancel?d.dismiss():d.accept());});
  page.on('pageerror',error=>errors.push(error.message));
  const start=async(mode,seed='regression')=>{
    await page.locator('#mode').selectOption(mode);
    await page.locator('#seed').fill(seed);
    await click('n');
  };
  try {
    const time=Date.parse('2024-01-05T12:00:00Z');
    await page.clock.install({time});
    await page.clock.pauseAt(time+1000);
    const viewport=page.viewportSize(), layouts=[];
    for(const href of new Set([url.split('/').slice(0,3).join('/')+'/',url])){
      for(const [width,height] of [[320,568],[375,667],[512,768],[768,1024],[1440,900],[844,390]]){
        await page.setViewportSize({width,height});
        await page.goto(href);
        const size=await board().evaluate(b=>{
          const r=b.getBoundingClientRect(), rows=[...b.children], cells=[...b.querySelectorAll('[role=gridcell]')];
          return {
            width:r.width,height:r.height,cells:cells.length,rows:rows.length,
            fits:document.documentElement.scrollWidth===innerWidth&&r.right<=innerWidth&&r.height<=innerHeight,
            square:cells.every(c=>{const r=c.getBoundingClientRect();return Math.abs(r.width-r.height)<1;}),
            unwrapped:rows.every(row=>row.children.length===25&&[...row.children].every(c=>Math.abs(c.getBoundingClientRect().top-row.getBoundingClientRect().top)<1))
          };
        });
        assert(size.cells===425&&size.rows===17&&size.unwrapped,'Map grid changed or wrapped');
        assert(size.fits&&size.square&&Math.abs(size.width/size.height-25/17)<.01,'Map must fit with square landscape cells');
        if(width===1440)assert(size.width>=1000,'Desktop battlefield is too small');
        await soldier(3).click();
        assert((await info()).startsWith('@4 '),'Responsive click selection');
        await board().press('q');
        assert((await info()).startsWith('@5 '),'Responsive keyboard selection');
        layouts.push({href,viewport:[width,height],width:size.width,height:size.height});
      }
    }
    console.log('Responsive landscape maps',JSON.stringify(layouts));
    await page.setViewportSize(viewport);
    await page.goto(url);
    await page.evaluate(async()=>{
      window.e=await import('/src/engine.js');
      window.meta=await import('/src/meta.js');
    });
    for(const mode of 'SNLXDO'){
      await start(mode);
      const code=await page.locator('#code').inputValue();
      assert(code.startsWith(`R7-1-${mode}-`),'Challenge mode '+mode);
      await soldier(3).click();
      assert((await info()).startsWith('@4 '),'Click selection');
      await board().press('q');
      assert((await info()).startsWith('@5 '),'Q order');
      await board().press('Shift+Q');
      assert((await info()).startsWith('@4 '),'Shift-Q order');
      await click('load');
      assert(await page.locator('#code').inputValue()===code,'Canonical reload');
    }
    await click('daily');
    assert(await page.locator('#seed').inputValue()==='R7D1:2024-01-05','UTC daily seed');
    assert((await page.locator('#code').inputValue()).startsWith('R7-1-O-'),'Daily operation identity');
    const dailyCode=await page.locator('#code').inputValue();
    const before=await labels();
    await page.locator('#code').fill('R7-2-S-YWJj');
    await click('load');
    assert(JSON.stringify(await labels())===JSON.stringify(before),'Invalid code changed game');
    assert((await page.locator('#log').innerText()).includes('Invalid code'),'Visible code error');
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
    await click('copy');
    assert(await page.locator('#code').inputValue()===dailyCode,'Manual copy selected edited text instead of the game code');
    assert(await page.locator('#code').evaluate(c=>c.selectionStart===0&&c.selectionEnd===c.value.length),'Manual copy did not select the code');
    await start('S','keyboard');
    await soldier(3).click();await click(' ');await settle();
    await soldier(3).click();
    assert((await info()).startsWith('@1 '),'Used soldier selected');
    await page.locator('#c26').click();
    const moving=await info();
    await board().press('q');await soldier(4).click({force:true});
    assert(await info()===moving,'Selection changed during animation');
    await settle();await board().press('q');
    assert((await info()).startsWith('@1 '),'Activation unlocked after moving');
    await click(' ');await settle();
    const cursor=+(await board().getAttribute('aria-activedescendant')).slice(1);
    await board().press('ArrowRight');
    assert(await board().getAttribute('aria-activedescendant')==='c'+(cursor+1),'Arrow cursor');
    assert(await page.locator('#c'+(cursor+1)).evaluate(c=>getComputedStyle(c).outlineStyle)==='solid','Cursor outline hidden');
    await board().press('Shift+Tab');
    assert(!await board().evaluate(b=>b===document.activeElement),'Shift-Tab must leave grid');
    await page.locator('#seed').fill('typed-nqf');
    assert(await page.locator('#seed').inputValue()==='typed-nqf','Typing invoked shortcuts');
    await page.locator('#contrast').check();
    assert(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)==='rgb(0, 0, 0)','Contrast toggle');
    const colors=await page.getByRole('gridcell',{name:/@\d /}).evaluateAll(cs=>cs.map(c=>getComputedStyle(c).color));
    assert(new Set(colors).size===6,'Six soldier colors');
    assert(await page.getByRole('gridcell',{name:/U1 /}).evaluate(c=>+getComputedStyle(c).fontWeight)>=700,'Bold unicorns');
    await page.locator('#motion').check();
    await start('S');await page.locator('#c26').click();await page.clock.runFor(1);
    assert(!await page.locator('#f').isDisabled(),'Reduced-motion action did not finish');
    await page.locator('#motion').uncheck();
    await click('h');
    assert(dialogs.at(-1).includes('Q/Shift-Q'),'Keyboard help');
    // Corrupt records must not be presented as a real best.
    const corruptCode=await page.locator('#code').inputValue();
    await page.evaluate(code=>localStorage.setItem(code,'{}'),corruptCode);
    await click('load');
    assert(!(await page.locator('#status').innerText()).includes('undefined'),'Corrupt best displayed');
    // Full operation, with a finite rocket resupply and actual recovery healing.
    const seed='both127';
    await start('O',seed);
    const operationCode=await page.locator('#code').inputValue();
    await page.evaluate(seed=>window.op=window.e.createOperation(seed),seed);
    const parity=async()=>{
      const expected=await page.evaluate(()=>op.state.units.map(u=>({
        id:u.id,p:u.p,hp:u.hp,label:e.label(u),weapon:e.weapons[u.w].join('/'),
        ammo:u.w==='R'?'ammo'+u.ammo:'',role:u.team?e.roleName[u.role]:''
      })));
      const actual=await labels();
      for(const u of expected){
        if(u.hp){
          const label=actual[u.p];
          assert(label.includes(u.label+' ')&&label.includes(u.hp+'HP')&&label.includes(u.weapon)&&label.includes(u.ammo)&&label.includes(u.role),'Model/production divergence: '+u.label);
        }else assert(!actual.some(label=>label.includes(' '+u.label+' ')),'Dead unit resurrected: '+u.label);
      }
      assert(await page.locator('#code').inputValue()===operationCode,'Mission replaced operation code');
      const accuracy=await page.evaluate(()=>op.state.stats.map(t=>t.shots?Math.round(100*t.hits/t.shots):0));
      const totals=(await page.locator('#status').innerText()).split('\n').filter(line=>/^[@U] /.test(line));
      assert(totals.length===2&&totals.every((line,i)=>line.endsWith(accuracy[i]+'%')),'Accuracy changed');
    };
    for(let turn=0;turn<180;turn++){
      const state=await page.evaluate(()=>({done:op.done,pending:op.pending,mission:op.mission,active:op.state.active}));
      if(state.done)break;
      if(state.pending){
        const recovery=state.mission===1;
        const target=await page.evaluate(()=>{const us=e.living(op.state,0);return(us.find(u=>u.w==='p')||us[0]).id;});
        if(recovery)healed=await page.evaluate(()=>e.living(op.state,0).some(u=>u.hp<3));
        await soldier(target).click();
        assert((await info()).startsWith('@'+(target+1)+' '),'Intermission recipient selection');
        await page.locator('#weapon').selectOption('R');
        await click(recovery?'recovery':'resupply');
        await page.evaluate(({recovery,target})=>e.applyIntermission(op,recovery?'recovery':'resupply',target,'R'),{recovery,target});
        assert(await page.locator('#recovery').isDisabled()&&await page.locator('#resupply').isDisabled(),'Intermission was reusable');
        if(recovery)assert((await page.locator('#status').innerText()).includes('Deadline:'),'Rescue deadline hidden');
        await parity();
        continue;
      }
      const a=await page.evaluate(()=>{const s=op.state,u=e.actor(s);return{...e.plan(s),from:u.p,id:u.id};});
      assert((await info()).startsWith('@'+(a.id+1)+' '),'Activation order');
      if(a.p!==a.from){
        const preview=await page.evaluate(p=>e.movePreview(op.state,e.actor(op.state),p),a.p);
        await page.locator('#c'+a.p).hover();
        assert((await info()).includes('Threats: '+preview.threats.length),'Destination threat count');
        const positions=await page.evaluate(ids=>ids.map(id=>op.state.units[id].p),preview.threats.map(t=>t.id));
        assert(await page.evaluate(ps=>ps.every(p=>getComputedStyle(document.getElementById('c'+p)).textDecorationLine.includes('underline')),positions),'Threat highlighting hidden');
        threats+=preview.threats.length;
        await page.locator('#c'+a.p).click();await settle();
        await page.evaluate(p=>e.move(op.state,p),a.p);
      }
      if(a.target!==undefined){
        const shot=await page.evaluate(p=>e.attackPreview(op.state,e.actor(op.state),p),a.target);
        await page.locator('#c'+a.target).hover();
        if(shot.cover!==undefined){
          covers++;
          assert((await info()).includes('cover '+shot.cover%25+','+(shot.cover/25|0)),'Intercepted cover tile');
        }
        if(shot.rocket&&!rockets){
          const saved=await labels();cancel=true;
          await page.locator('#c'+a.target).click();cancel=false;
          assert(JSON.stringify(await labels())===JSON.stringify(saved),'Cancelled rocket changed units');
        }
        await page.locator('#c'+a.target).click();
        if(shot.rocket){
          rockets++;
          const victims=await page.evaluate(ids=>ids.map(i=>e.label(op.state.units[i])),shot.victims);
          assert(victims.every(name=>dialogs.at(-1).includes(name)),'Rocket confirmation omitted a casualty');
        }
        const busyInfo=await info();
        await board().press('q');
        assert(await info()===busyInfo,'Projectile selection changed shooter');
        await page.evaluate(p=>e.fire(op.state,p,true),a.target);
      }else await click(' ');
      await page.evaluate(()=>e.end(op.state));
      await settle();
      await page.evaluate(()=>{
        const s=op.state;
        while(!s.result&&e.actor(s).team){
          const u=e.actor(s),a=e.plan(s);
          if(a.p!==u.p)e.move(s,a.p);
          if(a.target!==undefined)e.fire(s,a.target,true);
          e.end(s);
        }
        if(s.result)e.completeMission(op);
      });
      await parity();
    }
    const result=await page.evaluate(()=>({win:op.win,score:op.score,rounds:op.rounds}));
    assert(result.win&&rockets&&covers&&threats&&healed,'Incomplete operation/preview coverage');
    const status=await page.locator('#status').innerText();
    assert(status.includes(`Operation 3/3 ${result.score}pts ${result.rounds} rounds VICTORY`),'Operation totals');
    assert(status.includes('Local best VICTORY'),'Operation best not saved');
    await click('load');
    assert((await page.locator('#status').innerText()).includes('Local best VICTORY'),'Best did not survive reload');
    // Abandon during an AI action, then flush every obsolete timer.
    await start('O');
    for(let i=0;i<5;i++){await click(' ');await settle();}
    await click(' ');await page.clock.runFor(190);
    assert(await page.locator('#f').isDisabled(),'AI phase not active');
    await click('n');
    const fresh=await labels();await page.clock.runFor(60000);
    assert(JSON.stringify(await labels())===JSON.stringify(fresh),'Stale AI mutated restarted operation');
    assert((await page.locator('#status').innerText()).includes('Operation 1/3'),'Restart skipped mission one');
    await page.evaluate(()=>{
      Object.defineProperty(window,'localStorage',{configurable:true,get(){throw Error('storage disabled');}});
    });
    await click('n');
    assert((await page.locator('#warn').innerText()).includes('Storage unavailable'),'Missing storage warning');
    assert(await page.getByRole('gridcell').count()===425,'Storage failure broke game');
    assert(!errors.length,'Browser errors: '+errors.join('; '));
    return {operation:result,rockets,covers,threats,healed,checks:'modes/codes/daily, keyboard/mouse, previews, intermissions, bests, storage errors, restart'};
  }finally{await context.close();}
}
