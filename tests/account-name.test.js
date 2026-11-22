// สมัคร Steam / ยูแสนสุข ตั้งชื่อเองได้ + เปลี่ยนชื่อวันละครั้ง
const {boot,ok,done}=require('./lib');
(async()=>{console.log('account-name');const g=await boot({path:'str'}),{E,p}=g;
 await E("closeM();S.name='ต้นฉบับ';S.day=5;const t=strGet();t.stmN='';t.tubeN='';t.games=[];t.clips=[];t.subs=0");
 ok(await E("!accHas('stm')&&!accHas('tube')"),'บัญชีใหม่: ยังไม่ได้สมัคร');
 const d=await E("(()=>{const b=document.createElement('div');gstTab(b,()=>{});return b.textContent})()");ok(d.includes('สมัครบัญชี')&&d.includes('สมัครเลย'),'เปิด Steam ครั้งแรก → ฟอร์มสมัคร');
 await E("(()=>{window.__b=document.createElement('div');document.body.append(window.__b);gstTab(window.__b,()=>{});const i=__b.querySelector('input');i.value='ชาวสวนเซียน';[...__b.querySelectorAll('button')].find(x=>x.textContent==='สมัครเลย').click()})()");
 ok(await E("strGet().stmN")==='ชาวสวนเซียน'&&await E("stmName()")==='ชาวสวนเซียน','สมัคร Steam ตั้งชื่อเองได้');
 await E("(()=>{const b=document.createElement('div');gstTab(b,()=>{});window.__t=b.textContent})()");ok((await E("__t")).includes('ชาวสวนเซียน'),'หน้า Steam แสดงชื่อบัญชี');
 await E("(()=>{const f=accForm('stm',()=>{},true);const i=f.querySelector('input');i.value='ชื่อใหม่';f.querySelector('button').click()})()");ok(await E("strGet().stmN")==='ชาวสวนเซียน','วันเดียวกันเปลี่ยนชื่อซ้ำไม่ได้ (วันละครั้ง)');
 await E("S.day=6;(()=>{const f=accForm('stm',()=>{},true);const i=f.querySelector('input');i.value='ชื่อใหม่';f.querySelector('button').click()})()");ok(await E("strGet().stmN")==='ชื่อใหม่','ข้ามวัน เปลี่ยนชื่อได้');
 await E("(()=>{const f=accForm('tube',()=>{},false);f.querySelector('input').value='x';f.querySelector('button').click()})()");ok(!(await E("strGet().tubeN")),'ชื่อสั้นเกิน (<2) ไม่ผ่าน');
 await E("(()=>{const f=accForm('tube',()=>{},false);f.querySelector('input').value='ช่องสวนสุข';f.querySelector('button').click()})()");ok(await E("tubeName()")==='ช่องสวนสุข','สมัครยูแสนสุข ตั้งชื่อช่องเอง');
 ok(await E("(()=>{const d=webTube(()=>{});return d.textContent.includes('ช่องสวนสุข')})()"),'หน้ายูแสนสุขใช้ชื่อช่องที่ตั้ง');
 await E("(()=>{const t=strGet();t.stmN='';t.games=['x']})()");ok(await E("accHas('stm')&&strGet().stmN===S.name"),'ผู้เล่นเก่าที่มีเกมอยู่แล้ว = สมัครแล้ว (ใช้ชื่อตัวละคร)');
 await done(g,'account-name')})().catch(e=>{console.error(e);process.exit(1)});
