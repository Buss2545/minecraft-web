// ยืนนิ่งฟื้นพลังงาน +5 ต่อ 10 นาทีในเกม • อาหารทิพย์ทุกเช้า (แอนิเมชัน + อิ่ม 100)
const {boot,ok,done}=require('./lib');
(async()=>{const g=await boot(),{p,E}=g;console.log('daily');
 ok(await E('closeM();S._im=0;P.moving=false;P.sw=0;S.energy=50;idleRest(10);idleRest(10);S.energy')===60,'ยืนนิ่ง 20 นาทีในเกม ได้ +10');
 await E('S.full=20;toScene("i","player");sleepNow(false,"")');let seen=0;
 for(let i=0;i<40;i++){await p.waitForTimeout(250);if(await E('!!(P.sw&&P.sw.id==="eat"&&P.sw.ic==="🍱")'))seen=1}
 await p.waitForTimeout(3500);ok(seen===1,'ตื่นนอนแล้วมีแอนิเมชันกินอาหารทิพย์');ok(await E('S.full')===100,'หลอดอาหารเต็ม 100');
 await done(g,'daily')})();
