const {boot,ok,done}=require('./lib');

(async()=>{console.log('top buttons');const g=await boot(),{E,p}=g;
 await p.setViewportSize({width:390,height:844});await p.waitForTimeout(400);await E("closeM();toScene('w');S.inv.phone=1");
 await E("phoneBtn()");
 const rect=id=>p.evaluate(i=>{const r=document.getElementById(i).getBoundingClientRect();return[Math.round(r.left),Math.round(r.top),Math.round(r.width)]},id);
 const q0=await rect('bQuest'),m0=await rect('bMap'),mn0=await rect('menuBtn');
 await E("layStart()");await p.waitForTimeout(300);
 ok(await E("['bQuest','bMap','bPhone','menuBtn'].every(i=>document.getElementById(i).classList.contains('lay'))"),'4 ปุ่มเลือกแยกกันได้');
 await p.mouse.move(m0[0]+20,m0[1]+20);await p.mouse.down();await p.mouse.move(100,400,{steps:8});await p.mouse.up();
 const m1=await rect('bMap'),q1=await rect('bQuest'),mn1=await rect('menuBtn');console.log(m0,m1,q0,q1,mn0,mn1);
 ok(Math.abs(m1[1]-400)<40&&m1[0]<200,'ย้ายปุ่มแผนที่ไปที่อื่น');
 ok(q1[0]===q0[0]&&q1[1]===q0[1]||Math.abs(q1[1]-q0[1])<3,'ปุ่มภารกิจไม่ขยับตาม');
 /* ปรับขนาดปุ่มเดียว */
 await E("LSEL='menuBtn';layLbl()");await p.evaluate(()=>{const s=document.getElementById('laySl');s.value=200;s.dispatchEvent(new Event('input'))});
 const mn2=await p.evaluate(()=>document.getElementById('menuBtn').getBoundingClientRect().width);ok(mn2>mn0[2]*1.8,'ขยายปุ่มเมนูเพียงปุ่มเดียว '+Math.round(mn2));
 await p.screenshot({path:'/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/vp/qb.png'});
 await E("layEnd()");
 ok(await E("document.getElementById('bMap').click&&true"),'ปุ่มยังกดได้');
 await E("layStart();layReset();layEnd()");
 ok(await E("['bQuest','bMap','bPhone','menuBtn'].every(i=>document.getElementById(i).parentNode.id==='qbtns')"),'คืนค่าเดิม กลับเข้ากลุ่ม');
 const ord=await E("[...document.getElementById('qbtns').children].map(e=>e.id).join(',')");ok(ord==='bQuest,bMap,bPhone,menuBtn','ลำดับปุ่มเดิม '+ord);
 await done(g,'topbtn')})().catch(e=>{console.error(e);process.exit(1)});
