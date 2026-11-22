// สุ่มกดปุ่ม/แตะ/ย้ายฉาก ระหว่างเวลาเดินเร็ว เพื่อจับ error ที่ไม่ได้ทดสอบตรงๆ
const {boot,ok,done}=require('./lib');
(async()=>{console.log('fuzz');const g=await boot(),{E,p}=g;
 const keys=['w','a','s','d','e','Space','Escape','1','2','3','4','5','6','7','8','Enter','m','i','Tab'];
 const ids=JSON.parse(await E("JSON.stringify(BLD.map(b=>b.id))"));
 for(let i=0;i<260;i++){const r=Math.random();
  try{
   if(r<.55)await p.keyboard.press(keys[Math.floor(Math.random()*keys.length)],{delay:30});
   else if(r<.8)await p.mouse.click(40+Math.random()*560,60+Math.random()*380);
   else if(r<.9)await E("S.min=(S.min+37)%1440;S.money=Math.max(S.money,500);S.energy=Math.max(S.energy,60);S.hp=Math.max(S.hp,60)");
   else if(r<.95)await E("closeM();toScene('i','"+ids[Math.floor(Math.random()*ids.length)]+"')");
   else await E("closeM();toScene('w')");
  }catch(e){}
  await p.waitForTimeout(40)}
 await done(g,'fuzz')})().catch(e=>{console.error(e);process.exit(1)});
