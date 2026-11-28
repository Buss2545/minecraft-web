/* ออกจากอาคารมหานครแล้วตำแหน่งผู้เล่นต้องเป็นตัวเลข (เคยเป็น NaN ทำให้ภาพเมืองเพี้ยน/ซ้อน) */
const {boot,ok,done}=require('./lib.js');
(async()=>{const g=await boot();
 for(const id of ['bank','police','goldshop','hospital','gym']){
  await g.E("closeM();S.min=10*60;toScene('i','"+id+"')");await g.p.waitForTimeout(300);
  await g.E("leaveInt()");await g.p.waitForTimeout(300);
  ok(await g.E("curInt.id==='city'&&Number.isFinite(P.x)&&Number.isFinite(P.y)"),id+' ออกแล้วตำแหน่งปกติ');}
 await done(g,'cityexit')})();
