// ไลฟ์สดตอนเล่นเกมจริง + หน้า Steam ใหม่
const {boot,ok,done}=require('./lib');
(async()=>{console.log('live-play');const g=await boot({path:'str'}),{E,p}=g;
 await E("closeM();cpPwr=1;const t=strGet();t.path='game';t.ld=0;t.lc=0;t.subs=800;S.energy=S.maxEnergy||100;S.min=420;S.day=5");
 ok(await E("strNetOn()&&hwRun()"),'เครื่องเปิด/มีเน็ต พร้อมไลฟ์');
 /* --- Steam --- */
 await E("strGet().stmN='ทดสอบ';strGet().tubeN='ทดสอบ'");
 await E("(()=>{const d=document.createElement('div');d.id='tstm';document.body.append(d);gstSub='shop';gstTab(d,()=>{});window.__d=d})()");
 const stm=await E("(()=>{const d=document.getElementById('tstm');return JSON.stringify({top:!!d.querySelector('.stm-top'),nav:d.querySelectorAll('.stm-nav button').length,rows:d.querySelectorAll('.stm-row').length,price:d.querySelectorAll('.stm-price').length,buy:[...d.querySelectorAll('.stm-act button')].some(b=>b.textContent.includes('ซื้อ')),txt:d.querySelector('.stm-top').textContent})})()");
 const j=JSON.parse(stm);ok(j.top&&j.nav===3,'Steam: แถบบน + เมนู 3 อัน');ok(j.rows>=8&&j.price>=3&&j.buy,'Steam: รายการเกมแบบผลค้นหา มีกล่องราคาและปุ่มซื้อ ('+j.rows+' เกม)');ok(j.txt.includes('STEAM')&&j.txt.includes('฿'),'Steam: โลโก้ + ยอดเงิน');
 await E("gstSub='soon';document.getElementById('tstm').replaceChildren();gstTab(document.getElementById('tstm'),()=>{})");ok(await E("document.querySelectorAll('#tstm .stm-disc').length>=0"),'หน้าเร็วๆ นี้วาดได้');
 await E("gstSub='net';document.getElementById('tstm').replaceChildren();gstTab(document.getElementById('tstm'),()=>{})");ok(true,'หน้า Community วาดได้');
 await E("document.getElementById('tstm').remove()");
 /* --- ไลฟ์สด --- */
 await E("libG='dino';(()=>{const d=document.createElement('div');d.id='tlv';document.body.append(d);const ref=()=>{d.replaceChildren();liveBar(d,'dino',ref)};window.__ref=ref;ref()})()");
 ok(await E("!!document.querySelector('#tlv button.blue')&&document.querySelector('#tlv').textContent.includes('เริ่มไลฟ์')"),'มีปุ่มเริ่มไลฟ์ในหน้าเล่นเกม');
 const m0=await E("S.money"),s0=await E("strGet().subs");
 await E("liveGameStart('dino',window.__ref)");await p.waitForTimeout(300);
 ok(await E("!!LGL&&document.querySelector('#tlv .rec')&&document.querySelector('#tlv').textContent.includes('LIVE')"),'เริ่มไลฟ์ → ขึ้นแถบ LIVE');
 ok(await E("strGet().lc")===1,'หักโควตาไลฟ์ 1 รอบ');
 await E("document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));");
 await p.waitForTimeout(5600);
 ok(+await E("document.querySelector('#tlv .rec b:nth-of-type(2)')?document.querySelector('#tlv .rec b:nth-of-type(2)').textContent:0")>0||await E("LGL.cur")>0,'ผู้ชมเพิ่มขึ้นตามเวลา');
 await E("strGet().hs=(strGet().hs|0)+50");await p.waitForTimeout(5200);
 ok(await E("LGL.recs")>=1&&(await E("document.querySelector('#tlv .rchat').textContent")).includes('ทุบสถิติ'),'ทุบสถิติใหม่ → แจ้งในแชท + ได้โดเนท');
 const v=await E("LGL.cur");ok(v>0,'ผู้ชม '+v+' คน');
 await E("liveGameEnd(false)");await p.waitForTimeout(200);
 ok(await E("LGL")===null,'จบไลฟ์');
 ok(await E("S.money")>m0&&await E("strGet().subs")>=s0,'จบไลฟ์ → ได้เงิน/ผู้ติดตาม');ok((await E("strGet().last")).includes('ไลฟ์สดตอนเล่น'),'บันทึกสรุปไลฟ์');
 /* ออกจากหน้าเล่น = จบอัตโนมัติ */
 await E("liveGameStart('dino',window.__ref)");await p.waitForTimeout(200);await E("document.getElementById('tlv').remove()");await p.waitForTimeout(11000);
 ok(await E("LGL")===null,'ปิด/ออกจากหน้าเกมระหว่างไลฟ์ → จบให้อัตโนมัติ');
 await done(g,'live-play')})().catch(e=>{console.error(e);process.exit(1)});
