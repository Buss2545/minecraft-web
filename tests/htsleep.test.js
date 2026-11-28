/* ติดสารใจตอนดึก: นอนบ้านเก่า → ตื่นเช้าที่นั่น → นั่งรถกลับได้ */
const {boot,ok,done}=require('./lib.js');
(async()=>{const g=await boot();
 await g.E("closeM();S.day=SL*2+8;S.htSeen=1;S.min=20*60;toScene('i','hometown')");await g.p.waitForTimeout(600);
 await g.E("htExitMenu()");await g.p.waitForTimeout(1500);
 ok(await g.E("document.body.innerText.includes('ไปนอนที่บ้านเก่า')"),'มีปุ่มไปนอนบ้านเก่าตอนดึก');
 await g.E("[...document.querySelectorAll('.card button.b')].find(b=>b.textContent.includes('ไปนอนที่บ้านเก่า')).click()");await g.p.waitForTimeout(3000);
 ok(await g.E("scene==='i'&&curInt.id==='oldhome'"),'เข้าบ้านเก่า');
 const d0=await g.E("S.day");
 await g.E("oldhomeFurn({t:'bed'})");await g.p.waitForTimeout(1500);
 await g.E("[...document.querySelectorAll('.card button.b')].find(b=>b.textContent.includes('นอนที่บ้านเก่า')).click()");
 await g.p.waitForTimeout(7000);
 ok(await g.E("scene==='i'&&curInt.id==='oldhome'&&S.day==="+d0+"+1&&S.min<8*60&&Number.isFinite(P.x)"),'ตื่นเช้าวันใหม่ที่บ้านเก่า');
 await g.E("htExitMenu()");await g.p.waitForTimeout(1500);
 ok(await g.E("![...document.querySelectorAll('.card button.b')].find(b=>b.textContent.includes('นั่งรถสองแถวกลับ')).disabled"),'เช้านี้นั่งรถกลับได้');
 await done(g,'htsleep')})();
