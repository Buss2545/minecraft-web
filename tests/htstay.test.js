/* เมนูออกจากเมืองต้นทาง: กด "อยู่ต่อ" แล้วต้องไม่วนเปิดซ้ำ และเดินต่อได้ */
const {boot,ok,done}=require('./lib.js');
(async()=>{const g=await boot();
 await g.E("closeM();S.day=SL*2+8;S.htSeen=1;S.min=10*60;toScene('i','hometown')");await g.p.waitForTimeout(600);
 await g.E("P.y=(curInt.h-0.3)*TS;P.x=curInt.ex*TS+TS/2;P.moving=true;leaveInt()");await g.p.waitForTimeout(400);
 ok(await g.E("!!document.body.innerText.includes('ออกจากเมืองต้นทาง')"),'เมนูออกขึ้น');
 await g.E("[...document.querySelectorAll('.card button.b')].find(b=>b.textContent.includes('อยู่ต่อ')).click()");
 const y0=await g.E("P.y");
 await g.p.waitForTimeout(3000);
 ok(!(await g.E("!!document.body.innerText.includes('ออกจากเมืองต้นทาง')")),'กดอยู่ต่อแล้วเมนูไม่เด้งซ้ำ');
 ok(await g.E("P.y<"+y0+"+1")&&await g.E("curInt.id==='hometown'"),'ยังอยู่ในเมืองและขยับออกจากทางออกแล้ว');
 await done(g,'htstay')})();
