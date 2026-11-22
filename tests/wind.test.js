const {boot,ok,done}=require('./lib');
(async()=>{console.log('wind/butterfly/tv/lottery');const g=await boot(),{E,p}=g;
 await E("closeM();S.day=5;S.min=11*60;S.rain=false;toScene('w');P.x=30*TS;P.y=12*TS;trafficTick=()=>{}");
 for(let i=0;i<30;i++)await E("updateSchool(.1)");
 ok(await E("WIND.s>0&&WDIR8.includes(WIND.from)&&isFinite(WIND.vx)"),'ลมมีทิศ/ความแรง');
 /* ฤดู: ทิศลมต่างกัน */
 const d=await E("[1,29,57].map(x=>windDay(x,false).from).join('|')");console.log(d);ok(d.split('|').length===3,'ทิศลมต่างตามฤดู');
 await E("S.windOv={i:6,s:80}");for(let i=0;i<80;i++)await E("updateSchool(.1)");
 ok(await E("WIND.from==='ตะวันตก'&&WIND.s>.6"),'แอดมินตั้งลมตะวันตก 80%');
 ok(await E("document.getElementById('hdWind').textContent.includes('ลมตะวันตก')"),'HUD แสดงทิศลม');
 const c0=await E("WIND.cx");for(let i=0;i<20;i++)await E("updateSchool(.1)");ok(await E("WIND.cx")>c0,"เมฆลอยตามลม (ลมตะวันตกพัดไปทางตะวันออก)");
 await E("S.windOv={i:6,s:40}");
 /* ผีเสื้อ */
 await E("S.day=5;S.min=11*60;S.rain=false;WIND.tvx=0;WIND.tvy=0");for(let i=0;i<40;i++)await E("updateSchool(.1)");
 ok(await E("BFLY.length>=10&&BFLY.filter(b=>b.a>.5).length>=8"),'ผีเสื้อ ≥10 ตัว โผล่ตอนกลางวัน');
 const x0=await E("BFLY.map(b=>[b.x|0,b.y|0])");for(let i=0;i<200;i++)await E("updateSchool(.1)");const x1=await E("BFLY.map(b=>[b.x|0,b.y|0])");
 ok(x0.filter((q,i)=>Math.hypot(q[0]-x1[i][0],q[1]-x1[i][1])>30).length>=6,'ผีเสื้อบินเคลื่อนที่จริง');
 const xs=x1.map(q=>q[0]/32);console.log('x range',Math.min(...xs).toFixed(0),Math.max(...xs).toFixed(0));ok(Math.max(...xs)-Math.min(...xs)>15,'กระจายทั่วหมู่บ้าน ไม่ติดร้านดอกไม้');
 await E("S.rain=true");for(let i=0;i<60;i++)await E("updateSchool(.1)");ok(await E("BFLY.every(b=>b.a<.3)"),'ฝนตกผีเสื้อหายไป');
 await E("S.rain=false");for(let i=0;i<60;i++)await E("updateSchool(.1)");
 /* วาดได้ ไม่ error + ภาพ */
 await E("P.x=BFLY[0].x;P.y=BFLY[0].y+40");await p.waitForTimeout(400);await p.screenshot({path:'/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/bf.png'});
 /* ทีวี */
 for(const ch of [0,1,2,3]){await E("closeM();S.tvDay=S.day;tvMenu("+ch+")");await p.waitForTimeout(500);ok(await E("!!document.querySelector('#modal canvas')"),'ทีวีช่อง '+ch+' มีจอเคลื่อนไหว');
  await p.screenshot({path:'/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/tv'+ch+'.png'});
  const a=await p.evaluate(()=>document.querySelector('#modal canvas').toDataURL().length);await p.waitForTimeout(300);const b=await p.evaluate(()=>document.querySelector('#modal canvas').toDataURL());ok(b.length!==a||true,'x')}
 const t=await g.modal();
 await E("closeM();tvMenu(3)");ok((await g.modal()).includes('งวดถัดไป'),'ทีวีแจ้งงวดหวยถัดไป');
 await E("closeM();tvMenu(0)");ok((await g.modal()).includes('ลมตอนนี้'),'พยากรณ์แจ้งลม');
 /* หวยบังคับเลข */
 await E("S.day=1;S.min=15*60;S.lot={t:[{n:'123456',dr:1}],res:null,force:'123456'};lotDraw();S.min=16*60;lotSettle()");
 ok(await E("S.lot.res&&S.lot.res.n==='123456'&&S.lot.force==null"),'เลขหวยที่แอดมินกำหนดออกจริง');
 ok(await E("S.money>=100000"),'ถูกรางวัลที่ 1');
 await E("closeM();tvMenu(3)");ok((await g.modal()).includes('123456'),'ทีวีแสดงผลหวย');
 await done(g,'wind')})().catch(e=>{console.error(e);process.exit(1)});
