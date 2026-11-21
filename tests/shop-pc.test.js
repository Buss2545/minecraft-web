// คอมตั้งโต๊ะเช่าในร้านโทรศัพท์ (แยกจากคอมของเรา)
const {boot,ok,done}=require('./lib');
(async()=>{console.log('shop-pc');const g=await boot({path:'str'}),{E,p}=g;
 await E("closeM();S.money=5000;S.day=5;const t=strGet();t.rd=0;t.spc=0;cpPwr=0;cpSlp=0;t.cpu=0;t.gpu=0;t.ram=1;t.net=0;t.nd=0");
 ok(await E("!strRent()&&!strNetOn()&&!shopPc"),'ก่อนเช่า: คอมเราสเปกต่ำ ไม่มีเน็ต');
 await E("shop('phone','spc')");await p.waitForTimeout(400);
 const tx=await E("M.textContent");ok(tx.includes('คนละเครื่อง')&&tx.includes('฿200'),'แท็บคอมเช่าในร้าน แสดงราคา ฿200/วัน');
 ok(await E("[...M.querySelectorAll('button')].filter(b=>b.disabled&&b.textContent==='-').length===1"),'ยังไม่เช่า → นั่งใช้ไม่ได้');
 await E("[...M.querySelectorAll('button')].find(b=>b.textContent.includes('เช่า ฿200')).click()");await p.waitForTimeout(800);
 ok(await E("S.money")===4800&&await E("strGet().spc")===5,'เช่า → หักเงิน ฿200 และจำวันที่เช่า');
 ok(await E("!strRent()&&strGet().cpu===0&&strGet().gpu===0"),'เช่าแล้วคอมของเราไม่เปลี่ยน');
 await E("[...M.querySelectorAll('button')].find(b=>b.textContent==='นั่งใช้').click()");await p.waitForTimeout(800);
 ok(await E("shopPc===1&&cpPwr===1&&strRent()&&strNetOn()&&hwRun()"),'นั่งใช้ → เครื่องร้านเปิด สเปกสูงสุด มีเน็ต พร้อมใช้');
 ok(await E("strEff('cpu')===STR_PARTS.cpu.L.length-1&&strEff('gpu')===STR_PARTS.gpu.L.length-1&&netMbps()===1000"),'สเปกสูงสุด + 1 Gbps');
 ok(await E("strGet().cpu===0&&strGet().gpu===0"),'ค่าฮาร์ดแวร์คอมเราไม่ถูกแก้');
 ok(await E("!netHot()&&netPingBase()===6"),'เน็ตร้าน: เร็วสุด ปิงต่ำสุด (6ms) ไม่ใช้ฮอตสปอต');
 await E("closeM()");
 ok(await E("shopPc===0&&cpPwr===0&&!strRent()&&!strNetOn()"),'ลุกจากโต๊ะ → กลับเป็นคอมของเรา (ปิดอยู่ ไม่มีเน็ต)');
 await E("S.day=6");ok(await E("!shopPcPaid()"),'ข้ามวัน → ต้องเช่าใหม่');
 /* คลิกที่คอมตั้งโต๊ะในฉากร้าน */
 await E("closeM();S.day=7;strGet().spc=0;S.money=1000;shopPcDesk()");await p.waitForTimeout(400);
 ok((await E("M.textContent")).includes('เช่า ฿200'),'คอมในร้าน: การ์ดเช่า');
 await E("[...M.querySelectorAll('button')].find(b=>b.textContent.includes('เช่า ฿200')).click()");await p.waitForTimeout(900);
 ok(await E("S.money")===800&&await E("shopPc===1&&hwRun()"),'เช่าแล้วนั่งใช้ทันที');
 await E("closeM()");
 /* เช่า 1 วัน = ใช้ได้ทั้งวัน ออกเข้าซ้ำไม่เสียเพิ่ม • ข้ามวันขณะนั่ง = ปิดเครื่อง ต้องเช่าใหม่ */
 await E("closeM();S.day=9;strGet().spc=9;S.money=1000;shopPcEnter()");await p.waitForTimeout(300);await E("closeM();shopPcEnter()");await p.waitForTimeout(300);
 ok(await E("shopPc===1&&S.money===1000"),'วันเดียวกัน ออก/เข้าใหม่ไม่เสียเงินซ้ำ');
 await E("S.day=10;strRentTick()");await p.waitForTimeout(300);
 ok(await E("shopPc===0&&!shopPcPaid()"),'ข้ามวันขณะนั่ง → เครื่องร้านปิด ต้องเช่าใหม่');
 await E("shopPcDesk()");await p.waitForTimeout(300);ok((await E("M.textContent")).includes('เช่า ฿200'),'วันใหม่ → ขึ้น ฿200 เหมือนเดิม');await E("closeM()");
 await done(g,'shop-pc')})().catch(e=>{console.error(e);process.exit(1)});
