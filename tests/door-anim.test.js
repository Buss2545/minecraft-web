// ฉากเปิด/ปิดประตูตอนเข้า-ออกอาคาร + ฉากรถไปเมืองตรงกับตึกในเมือง
const {boot,ok,done}=require('./lib');
(async()=>{console.log('door-anim');const g=await boot(),{E,p}=g;
 await E("closeM();S.min=10*60;S.money=999;toScene('w');const b=BID.grocery;P.x=(b.d+.5)*TS;P.y=(b.y2+1)*TS+10;enterBld(b)");
 await p.waitForTimeout(500);
 ok(await E("!!document.getElementById('doorCv')&&scene==='w'&&paused===true"),'เข้าอาคาร: มีฉากประตู และยังอยู่ฉากโลกระหว่างเล่นอนิเมชัน');
 await p.screenshot({path:'/tmp/door1.png'});
 await p.waitForTimeout(500);await p.screenshot({path:'/tmp/door2.png'});
 await p.waitForTimeout(1400);
 ok(await E("scene==='i'&&curInt.id==='grocery'"),'จบอนิเมชัน → เข้าถึงในร้านจริง');
 await p.waitForTimeout(700);ok(await E("!document.getElementById('doorCv')&&!paused&&!EDGE_BUSY"),'ฉากประตูหายไป เล่นต่อได้');
 await E("leaveInt()");await p.waitForTimeout(500);
 ok(await E("!!document.getElementById('doorCv')&&scene==='w'"),'ออกอาคาร: มีฉากประตู (สลับกลับโลกใต้ผ้าดำ)');
 await p.screenshot({path:'/tmp/door3.png'});
 await p.waitForTimeout(2000);
 ok(await E("!document.getElementById('doorCv')&&scene==='w'&&Math.abs(P.x-(BID.grocery.d+1)*TS)<2&&!paused&&!EDGE_BUSY"),'ออกแล้วยืนหน้าประตูร้าน เล่นต่อได้');
 /* แตะข้าม */
 await E("closeM();const b=BID.clinic;P.x=(b.d+.5)*TS;P.y=(b.y2+1)*TS+10;enterBld(b)");await p.waitForTimeout(800);
 await E("document.getElementById('doorCv').dispatchEvent(new PointerEvent('pointerdown'))");await p.waitForTimeout(900);
 ok(await E("scene==='i'&&curInt.id==='clinic'"),'แตะข้ามอนิเมชันได้');
 await p.waitForTimeout(800);
 /* ฉากรถไปเมือง: ตึกแถวต้องมาจากฉากเมืองจริง ตลาดอยู่เหนือป้ายรถ */
 const sh=await E("(()=>{const fa=mkInt('city').fac;const mk=fa.find(f=>/ตลาด/.test(f.t));const ex=mkInt('city').ex;return mk.x<=ex&&ex<mk.x+mk.w})()");ok(sh,'ทางออก/ป้ายรถในเมืองอยู่ใต้ตลาดมหานคร (ตรงกับฉากรถ)');
 await E("closeM();toScene('w');rideTrip('go',()=>{},()=>{},1)");await p.waitForTimeout(1500);await p.screenshot({path:'/tmp/ride.png'});
 await done(g,'door-anim')})().catch(e=>{console.error(e);process.exit(1)});
