/* รถสองแถวไปสารใจ (ฉากนั่งรถ) + เวลาเดิน 5 ชม. */
const {boot,ok,done}=require('./lib.js');
(async()=>{const g=await boot();
 await g.E("closeM();S.day=SL*2+8;S.htSeen=1;S.min=9*60;S.money=500");
 await g.E("htBusGo()");await g.p.waitForTimeout(800);
 ok(await g.E("!!RIDE&&RIDE.dest==='สารใจ'&&RIDE.bg[1]==='town'"),'เริ่มฉากรถไปสารใจ');
 await g.p.waitForTimeout(3000);
 for(let i=0;i<8&&await g.E("!!RIDE");i++){await g.E("rideSkip()");await g.p.waitForTimeout(1200)}
 await g.p.waitForTimeout(2500);
 ok(await g.E("!RIDE&&scene==='i'&&curInt.id==='hometown'"),'ถึงสารใจในฉากเมือง');
 ok(await g.E("S.min>=9*60+35&&S.min<9*60+60"),'รถใช้เวลาราว 35 นาที');
 /* ขากลับ */
 await g.E("htExitMenu()");await g.p.waitForTimeout(1500);
 await g.E("[...document.querySelectorAll('.card button.b')].find(b=>b.textContent.includes('นั่งรถสองแถวกลับ')).click()");await g.p.waitForTimeout(800);
 ok(await g.E("!!RIDE&&RIDE.dest==='สุขใจ'&&RIDE.bg[0]==='town'"),'ฉากรถขากลับ');
 for(let i=0;i<8&&await g.E("!!RIDE");i++){await g.E("rideSkip()");await g.p.waitForTimeout(1200)}
 await g.p.waitForTimeout(2000);
 ok(await g.E("!RIDE&&scene==='w'"),'กลับถึงหมู่บ้าน');
 /* เดิน 5 ชม. */
 await g.E("closeM();S.min=9*60;toScene('i','hometown')");await g.p.waitForTimeout(600);
 await g.E("htExitMenu()");await g.p.waitForTimeout(1500);
 await g.E("[...document.querySelectorAll('.card button.b')].find(b=>b.textContent.includes('เดินกลับ')).click()");await g.p.waitForTimeout(3500);
 ok(await g.E("scene==='w'&&S.min>=14*60&&S.min<14*60+40"),'เดินกลับกิน 5 ชม. (09:00→14:00)');
 await g.E("S.min=21*60;P.x=72*TS;P.y=-16*TS;P.moving=true;edgeTick()");await g.p.waitForTimeout(600);
 ok(await g.E("scene==='w'&&S.min<21*60+40"),'ตอนดึกเดินไปสารใจไม่ได้');
 await g.E("S.min=8*60;P.x=72*TS;P.y=-16*TS;P.moving=true;edgeTick()");for(let i=0;i<30&&!(await g.E("scene==='i'"));i++)await g.p.waitForTimeout(400);await g.p.waitForTimeout(300);
 ok(await g.E("scene==='i'&&curInt.id==='hometown'&&S.min>=13*60&&S.min<13*60+40"),'เดินไปกิน 5 ชม. (08:00→13:00)');
 await done(g,'htride')})();
