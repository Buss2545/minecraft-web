const {boot,ok,done}=require('./lib');
(async()=>{console.log('festival activity scenes');const g=await boot(),{E,p}=g;await p.setViewportSize({width:390,height:844});
 for(const k of['rocket','goldfish','snowman','snowfight','water','krathong','trophy']){
  await E("window.__a=0;festAct('"+k+"',{ht:300,top:1,win:1,ic:'🐟',msg:'x'},()=>{window.__a=1})");
  await p.waitForTimeout(700);ok(await E("!!document.querySelector('#festCv')"),k+': แสดงผ้าใบเต็มจอ');
  if(k==='rocket')await p.screenshot({path:'/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/fest_'+k+'.png'});
  await p.click('#festCv');await p.waitForTimeout(1200);
  ok(await E("window.__a===1&&!document.querySelector('#festCv')&&!paused"),k+': แตะข้ามแล้วจบ + ปลดพัก');}
 ok(await E("festAct('nope',{},()=>{window.__b=1})")===false&&await E("window.__b===1"),'ชนิดไม่รู้จักไม่ค้าง');
 await E("S.day=1;const fe={k:'bangfai'};S.inv.bangfai=2;S.festDone={};bangfaiMenu(fe)");
 await done(g,'festact')})().catch(e=>{console.error(e);process.exit(1)});
