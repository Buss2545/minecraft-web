/* เมนูเพื่อน: มีโปรไฟล์ตัวละครทุกคนที่ให้ของขวัญได้ (ชาวบ้าน/เมืองต้นทาง/มหานคร) */
const {boot,ok,done}=require('./lib.js');
(async()=>{const g=await boot();
 await g.E("closeM();S.day=SL*2+7;menu('rel')");await g.p.waitForTimeout(700);
 const total=await g.E("NPCS.length+SK.length+1+HTR.length+CTW.length+CTS.length");
 ok(await g.E("document.querySelectorAll('.sheet .row.rel').length")===total,'แถวเพื่อนครบ '+total+' คน');
 const names=await g.E("[...document.querySelectorAll('.sheet .row.rel b')].map(b=>b.textContent)");
 for(const n of ['กาฟิว','ลุงสมชาย','คุณวิภา','คุณธนา','ยายสี'])ok(names.includes(n),'มีแถว '+n);
 for(const i of [0,8,20,30,Math.min(total-1,40)]){
  await g.E("closeM();menu('rel')");await g.p.waitForTimeout(700);
  await g.E("document.querySelectorAll('.sheet .row.rel')["+i+"].click()");await g.p.waitForTimeout(700);
  const t=await g.E("[...document.querySelectorAll('.card')].filter(c=>c.offsetParent).map(c=>c.innerText).join('|')");
  if(process.env.DBG)console.log(JSON.stringify(t).slice(0,200));
  ok(t&&t.includes('วันเกิด')&&t.includes('ชอบมาก')&&t.includes('สถานะ'),'โปรไฟล์ #'+i+' แสดงครบ');
  await g.E("[...document.querySelectorAll('.card button.b')].find(b=>b.textContent.includes('กลับ')).click()");await g.p.waitForTimeout(700);
  ok(await g.E("!!document.querySelector('.sheet .row.rel')"),'ปุ่มกลับ #'+i+' ได้');}
 await done(g,'relprofile')})();
