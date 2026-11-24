const {boot,ok,done}=require('./lib');
const SP='/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/';
(async()=>{console.log('ship summary');const g=await boot(),{E,p}=g;await p.setViewportSize({width:390,height:844});
 await E("closeM();toScene('w')");
 const r=await E("(()=>{const m0=S.money;const ks=Object.keys(CROPS).slice(0,6);S.bin=ks.map((k,i)=>({k:'crop:'+k,n:3+i}));const raw=S.bin.length,[n,tot,rows,b]=ship();return JSON.stringify({n,tot,rows:rows.length,sum:rows.reduce((a,x)=>a+x.v,0),d:S.money-m0,raw,ok:rows.every(x=>x.nm&&x.ic&&x.n>0&&x.v>0),bin:S.bin.length})})()").then(JSON.parse);console.log(JSON.stringify(r));
 ok(r.rows===r.raw&&r.sum===r.tot&&r.d===r.tot&&r.ok&&r.bin===0,'ship(): แจกแจงรายการ ผลรวม = เงินที่ได้ (รวมโบนัส)');
 ok(await E("(()=>{S.bin=[];const x=ship();return x[0]===0&&x[1]===0&&x[2].length===0})()"),'ลังว่าง → ไม่มีรายการ');
 /* ฉาก: เปิด → เห็นผ้าใบ → แตะข้ามช่วงรถ → แตะดูผลเลย → แตะไปต่อ → ปิดและกลับมาเล่นต่อ */
 await E("window.__after=0;shipScene([{k:'a',n:5,v:350,nm:'ข้าวโพด',ic:'🌽'},{k:'b',n:3,v:90,nm:'มะเขือเทศ',ic:'🍅'}],440,8,12,()=>{window.__after=1})");
 await p.waitForTimeout(400);ok(!!(await p.$('#shipCv'))&&await E("paused===true"),'เปิดฉากสรุป + หยุดเกม');
 await p.waitForTimeout(1400);await p.screenshot({path:SP+'ship1.png'});
 await p.click('#shipCv');await p.waitForTimeout(1200);await p.screenshot({path:SP+'ship2.png'});
 await p.click('#shipCv');await p.waitForTimeout(500);await p.screenshot({path:SP+'ship3.png'});
 await p.click('#shipCv');await p.waitForTimeout(500);
 ok(!(await p.$('#shipCv'))&&await E("window.__after")===1&&await E("paused===false"),'แตะจบ → ปิดฉาก เรียกต่อ และเกมเล่นต่อได้');
 /* รายการเยอะ → รวมเป็น "อื่นๆ" ไม่ล้นกรอบ */
 await E("window.__a2=0;shipScene(Array.from({length:30},(_,i)=>({k:'x'+i,n:2,v:10+i,nm:'ของ'+i,ic:'📦'})),1000,60,0,()=>{window.__a2=1})");await p.waitForTimeout(1500);await p.click('#shipCv');await p.waitForTimeout(800);await p.screenshot({path:SP+'ship4.png'});
 await p.click('#shipCv');await p.waitForTimeout(300);await p.click('#shipCv').catch(()=>{});await p.waitForTimeout(400);ok(await E("window.__a2")===1,'รายการ 30 อย่างก็ปิดได้');
 /* ตอนนอนจริง: ของในลัง → ฉากขึ้น เงินเข้า */
 await E("closeM();S.bin=[{k:'crop:'+Object.keys(CROPS)[0],n:4}];window.__m0=S.money;sleepNow(false,null,{})");
 let seen=false;for(let i=0;i<30&&!seen;i++){await p.waitForTimeout(400);seen=!!(await p.$('#shipCv'))}
 ok(seen,'นอนแล้วมีฉากสรุปการขายขึ้นมา');ok(await E("S.money>window.__m0"),'เงินจากลังเข้ากระเป๋า');
 await p.click('#shipCv').catch(()=>{});await p.waitForTimeout(300);await p.click('#shipCv').catch(()=>{});await p.waitForTimeout(300);await p.click('#shipCv').catch(()=>{});await p.waitForTimeout(600);
 ok(!(await p.$('#shipCv'))&&await E("paused===false"),'จบแล้วเล่นต่อได้');
 await done(g,'shipsum')})().catch(e=>{console.error(e);process.exit(1)});
