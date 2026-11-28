/* เดินออกถนนเหนือจากสารใจ แล้วต้องไม่ถูกดูดกลับเข้าเมือง */
const {boot,ok,done}=require('./lib.js');
(async()=>{const g=await boot();
 await g.E("closeM();S.day=SL*2+8;S.htSeen=1;S.min=10*60;toScene('i','hometown')");await g.p.waitForTimeout(600);
 await g.E("htExitMenu()");await g.p.waitForTimeout(1500);
 await g.E("[...document.querySelectorAll('.card button.b')].find(b=>b.textContent.includes('เดินออกถนนเหนือ')).click()");
 await g.p.waitForTimeout(3500);
 console.log(await g.E("[scene,curInt&&curInt.id,P.x/TS,P.y/TS,EDGE_BUSY]"));
 ok(await g.E("scene==='w'"),'อยู่ฉากโลก');
 await g.E("P.moving=true");await g.p.waitForTimeout(2500);
 ok(await g.E("scene==='w'&&P.y>-15*TS"),'ไม่ถูกดูดกลับเมือง');
 await done(g,'htwalkout')})();
