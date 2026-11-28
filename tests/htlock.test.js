/* เมืองต้นทางล็อกจนถึงปี1 ฤดูหนาว วันที่7 */
const {boot,ok,done}=require('./lib.js');
(async()=>{const g=await boot();
 await g.E("closeM();S.day=SL*2+6;S.money=500;S.min=10*60");
 ok(await g.E("htOpen()===false"),'วันที่ 6 ฤดูหนาว ยังล็อก');
 await g.E("P.x=72*TS;P.y=-16*TS;P.moving=true;edgeTick()");await g.p.waitForTimeout(500);
 ok(await g.E("scene==='w'"),'ถนนเหนือยังเข้าไม่ได้');
 await g.E("busMenu()");await g.p.waitForTimeout(300);
 ok(!(await g.E("document.body.innerText.includes('ไปเมืองต้นทาง')")),'ป้ายรถไม่มีตั๋วเมืองต้นทาง');
 await g.E("closeM();menu('rel')");await g.p.waitForTimeout(500);
 ok(!(await g.E("document.body.innerText.includes('ชาวเมืองต้นทาง')")),'เมนูเพื่อนซ่อนชาวเมืองต้นทาง');
 await g.E("closeM();S.day=SL*2+7");
 ok(await g.E("htOpen()===true"),'วันที่ 7 เปิด');
 await g.E("busMenu()");await g.p.waitForTimeout(300);
 ok(await g.E("document.body.innerText.includes('ไปเมืองต้นทาง')"),'วันที่ 7 มีตั๋ว');
 await done(g,'htlock')})();
