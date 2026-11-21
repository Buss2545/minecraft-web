// แท็บสถานะ: ไม่มีปุ่ม "ทำเลย" ฟิตเนส และไม่มีส่วนพระ • เรื่องพระอยู่ในเหรียญตรา (ความสำเร็จ) • สอบพระวินัยเฉพาะผู้เล่นชาย
const {boot,ok,done}=require('./lib');
(async()=>{console.log('status-panel');const g=await boot();
 await g.E("menu('status')");await g.p.waitForTimeout(400);let m=await g.modal();
 ok(m.includes('ฟิตเนส'),'ยังแสดงเลเวลฟิตเนส');ok(!m.includes('ทำเลย'),'ไม่มีปุ่มทำเลย');ok(!m.includes('พระและวัด'),'แท็บสถานะไม่มีส่วนพระ');
 await g.E("S.gender='m';menu('dex')");await g.p.waitForTimeout(400);m=await g.modal();
 ok(m.includes('สอบผ่านพระวินัย')&&m.includes('ศรัทธาใส่บาตร'),'ชาย: เหรียญตรามีหมวดพระ + สอบพระวินัย');
 await g.E("S.gender='f';menu('dex')");await g.p.waitForTimeout(400);m=await g.modal();
 ok(!m.includes('สอบผ่านพระวินัย')&&m.includes('ผู้ศึกษาพระวินัย'),'หญิง: ไม่มีเหรียญสอบ แต่มีเหรียญอื่นของพระ');
 const k="SK.find(x=>x.t==='monk')";
 await g.E("S.gender='f';closeM()");await g.E("monkExam("+k+")");await g.p.waitForTimeout(300);
 ok((await g.modal()).includes('ผู้ชายเท่านั้น')||await g.p.evaluate(()=>document.body.innerText.includes('ผู้ชายเท่านั้น')),'หญิงสอบไม่ได้');
 await g.E("S.gender='m';S.vinAll=0;S.examDay=0;S.examPass=0;closeM()");await g.E("monkExam("+k+")");await g.p.waitForTimeout(300);
 ok(await g.p.evaluate(()=>document.body.innerText.includes('ศึกษาพระวินัยให้ครบ')),'ยังอ่านไม่ครบ → สอบไม่ได้');
 await g.p.keyboard.press('Escape');await g.E("closeM();S.vinAll=1;S.vinSeen={0:1,1:1,2:1,3:1,4:1,5:1,6:1,7:1,8:1,9:1,10:1}");
 await g.E("monkExam("+k+")");await g.p.waitForTimeout(300);
 for(let i=0;i<5;i++){await g.p.waitForTimeout(300);const ans=await g.p.evaluate(()=>{const t=document.querySelector('#modal .sub')||document.querySelector('.card .sub');return t?t.textContent:''});
  const q=await g.E("MONK_EXAM.find(e=>e[0]==="+JSON.stringify(ans)+")");
  if(!q){ok(false,'ไม่พบโจทย์ข้อ '+(i+1)+': '+ans);break}
  await g.p.click('button:has-text("'+q[1][q[2]]+'")');await g.p.waitForTimeout(700)}
 await g.p.waitForTimeout(500);for(let i=0;i<6;i++){await g.p.keyboard.press('Space');await g.p.waitForTimeout(150)}
 ok(await g.E("S.examPass")===1,'ตอบถูกหมด → สอบผ่าน');ok(await g.E("(badgeCheck(),!!S.badge.exam)"),'ได้เหรียญสอบผ่านพระวินัย');
 await done(g,'status-panel')})().catch(e=>{console.error(e);process.exit(1)});
