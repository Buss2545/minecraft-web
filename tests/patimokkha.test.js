const {boot,ok,done}=require('./lib');
const SP='/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/';
(async()=>{console.log('patimokkha');const g=await boot(),{E,p}=g;
 ok(await E("MONK_PAT.reduce((a,x)=>a+x.L.length,0)===227"),'ครบ 227 ข้อ');
 await E("closeM();S.day=16;S.min=20*60+10;S.rain=false;toScene('w')");
 ok(await E("patDay()&&patNow()"),'วันที่ 16 คืนนี้มีพิธี');
 ok(await E("(()=>{S.day=8;const a=patDay();S.day=28;const b=patDay();S.day=17;const c=patDay();S.day=16;return !a&&b&&!c})()"),'พิธีเฉพาะวันที่ 16/28');
 const k="SK.find(q=>q.id==='suk')";
 await E("skMenu("+k+")");ok((await g.modal()).includes('ร่วมฟังสวดพระปาติโมกข์'),'เมนูหลวงพี่มีปุ่มพิธี');
 await E("closeM();patCeremony("+k+")");await p.waitForTimeout(700);ok(await E("!!document.querySelector('#modal canvas')"),'พิธีมีฉาก');
 await p.screenshot({path:SP+'pat1.png'});
 ok((await g.modal()).includes('สุณาตุ'),'บทเปิดบาลี');
 /* ข้ามไปหมวดแรก รอช่วงถามความบริสุทธิ์ */
 await p.click('#modal button:has-text("ถัดไป")');await p.waitForTimeout(400);
 ok((await g.modal()).includes('ปาราชิก'),'หมวดปาราชิก');
 await p.waitForTimeout(9500);ok((await g.modal()).includes('ปุจฺฉามิ'),'ถามความบริสุทธิ์');
 await p.waitForTimeout(4200);ok((await g.modal()).includes('ปริสุทฺโธ'),'ทุกรูปนิ่งรับ');
 await p.screenshot({path:SP+'pat2.png'});
 /* กดถัดไปจนจบ */
 for(let i=0;i<12;i++){await p.click('#modal button:has-text("ถัดไป"), #modal button:has-text("จบพิธี")').catch(()=>{});await p.waitForTimeout(80)}
 await p.waitForTimeout(500);
 ok(await E("S.patCer===S.day&&S.blessed&&Object.keys(S.patSeen).length===11"),'จบพิธี ได้พร/ลงบันทึก');
 await E("closeM();patCeremony("+k+")");ok(await E("!document.querySelector('#modal canvas')"),'ฟังซ้ำไม่ได้ในคืนเดียว');
 await E("S.min=12*60;closeM();skMenu("+k+")");ok((await g.modal()).includes('20:00'),'นอกเวลา แจ้งเวลาพิธี');
 await done(g,'patimokkha')})().catch(e=>{console.error(e);process.exit(1)});
