const {boot,ok,done}=require('./lib');
const SP='/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/vp/';
(async()=>{console.log('layout editor');const g=await boot(),{E,p}=g;
 await p.setViewportSize({width:390,height:844});await p.waitForTimeout(400);
 await E("closeM();toScene('w')");
 await E("layStart()");await p.waitForTimeout(300);
 ok(await E("document.getElementById('tools').classList.contains('lay')"),'แถบเครื่องมือย้ายได้บนมือถือ');
 const r0=await p.evaluate(()=>{const r=document.getElementById('tools').getBoundingClientRect();return[r.left,r.top,r.width]});
 /* ลากแถบเครื่องมือไปบนจอ */
 await p.mouse.move(r0[0]+30,r0[1]+20);await p.mouse.down();await p.mouse.move(r0[0]+30,r0[1]-300,{steps:6});await p.mouse.up();
 const r1=await p.evaluate(()=>{const r=document.getElementById('tools').getBoundingClientRect();return[r.left,r.top,r.width]});console.log(r0,r1);
 ok(r1[1]<r0[1]-200,'ลากแถบเครื่องมือขึ้นได้');
 /* ปรับขนาดด้วยสไลเดอร์ */
 await p.evaluate(()=>{const s=document.getElementById('laySl');s.value=200;s.dispatchEvent(new Event('input'))});
 const w1=await p.evaluate(()=>document.getElementById('tools').getBoundingClientRect().width);ok(w1>r1[2]*1.6,'ขยาย 200% ('+Math.round(r1[2])+'→'+Math.round(w1)+')');
 await p.evaluate(()=>{const s=document.getElementById('laySl');s.value=40;s.dispatchEvent(new Event('input'))});
 const w2=await p.evaluate(()=>document.getElementById('tools').getBoundingClientRect().width);ok(w2<r1[2]*.5,'ย่อ 40%');
 await p.evaluate(()=>{const s=document.getElementById('laySl');s.value=100;s.dispatchEvent(new Event('input'))});
 /* ย้ายปุ่มทำ (btnA) */
 const a0=await p.evaluate(()=>{const r=document.getElementById('btnA').getBoundingClientRect();return[r.left,r.top]});
 await p.mouse.move(a0[0]+20,a0[1]+20);await p.mouse.down();await p.mouse.move(a0[0]-150,a0[1]-250,{steps:6});await p.mouse.up();
 const a1=await p.evaluate(()=>{const r=document.getElementById('btnA').getBoundingClientRect();return[r.left,r.top]});ok(a1[0]<a0[0]-100&&a1[1]<a0[1]-150,'ย้ายปุ่มทำได้');
 await p.screenshot({path:SP+'lay-edit.png'});
 await E("layEnd()");
 ok(await E("!!OPT.lay.tools&&!!OPT.lay.btnA"),'บันทึกเลย์เอาต์แนวตั้ง');
 /* แนวนอน: คัดลอกจากแนวตั้งครั้งแรก แล้วแก้แยกกันได้ */
 await p.setViewportSize({width:844,height:390});await p.waitForTimeout(500);
 await E("layApply()");
 ok(await E("!!OPT.layL&&OPT.layL.btnA!==OPT.lay.btnA"),'แนวนอนมีเลย์เอาต์ของตัวเอง');
 await E("layStart()");await E("LSEL='btnA';layLbl()");await p.evaluate(()=>{const s=document.getElementById('laySl');s.value=150;s.dispatchEvent(new Event('input'))});await E("layEnd()");
 ok(await E("OPT.layL.btnA.s===1.5&&!(OPT.lay.btnA.s>1.4)"),'ขนาดแนวนอนไม่กระทบแนวตั้ง');
 /* กลับแนวตั้ง: ใช้ค่าเดิม */
 await p.setViewportSize({width:390,height:844});await p.waitForTimeout(500);await E("layApply()");
 const sc=await p.evaluate(()=>getComputedStyle(document.getElementById('btnA')).scale);console.log('scale back',sc);ok(sc==='none'||Math.abs(parseFloat(sc)-1)<.01,'กลับแนวตั้งขนาดเดิม');
 /* คืนค่า */
 await E("layStart();layReset();layEnd()");ok(await E("Object.keys(OPT.lay).length===0"),'คืนค่าเดิม');
 await done(g,'layout')})().catch(e=>{console.error(e);process.exit(1)});

