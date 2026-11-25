const {boot,ok,done}=require('./lib');
(async()=>{console.log('food art');const g=await boot(),{E,p}=g;
 ok(await E("RECIPES.every(r=>{const c=foodArt(r.id,40);const d=c.getContext('2d').getImageData(0,0,24,24).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n>80})"),'ทุกเมนูวาดรูปได้ (ไม่ว่างเปล่า)');
 ok(await E("(()=>{const s=new Set();RECIPES.forEach(r=>s.add(foodArt(r.id,10).getContext('2d').getImageData(0,0,24,24).data.join(',')));return s.size>=RECIPES.length-6})()"),'แต่ละเมนูหน้าตาไม่ซ้ำกัน (ซ้ำได้ไม่เกิน 6)');
 ok(await E("webNorm('สมุดอาหาร')==='sansuk://food'&&webNorm('food.sansuk.com')==='sansuk://food'"),'เปิดเว็บสมุดอาหารได้');
 ok(await E("(()=>{const e=webFood(()=>{});return e.querySelectorAll('canvas.foodart').length===RECIPES.filter(r=>!r.sec||(S.ys&&S.ys.rec)).length})()"),'หน้าเว็บแสดงรูปครบทุกเมนู');
 await E("S.rcp=S.rcp||{};menu('cook')");await p.waitForTimeout(300);ok(await E("document.querySelectorAll('canvas.foodart').length>0"),'รายการทำอาหารใช้รูปพิกเซล');
 await done(g,'foodart')})().catch(e=>{console.error(e);process.exit(1)});
