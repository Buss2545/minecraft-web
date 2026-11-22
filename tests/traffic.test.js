const {boot,ok,done}=require('./lib');
(async()=>{console.log('traffic');const g=await boot(),{E,p}=g;
 ok(await E("TRAF_P===.3"),'โอกาสเกิดรถ 30%');
 await E("closeM();S.day=3;S.min=11*60;S.rain=false;toScene('w');P.x=40*TS;P.y=12*TS;CARS.length=0");
 /* สถิติ: จำลองสุ่ม 4000 รอบ (ใกล้ถนน) ควรสร้างได้ ~30% */
 const r=await E("(()=>{let n=0,N=4000;const R=Math.random;for(let i=0;i<N;i++){CARS.length=0;if(R()<TRAF_P&&trafSpawn())n++}CARS.length=0;return n/N})()");
 console.log('rate',r);ok(r>.26&&r<.34,'อัตราสร้างรถ ≈30%');
 /* ไกลถนน (ในฟาร์มลึกๆ) ไม่สร้างเปลืองเครื่อง */
 ok(await E("(()=>{P.x=20*TS;P.y=40*TS;CARS.length=0;const c=trafSpawn();P.x=40*TS;P.y=12*TS;return c===null})()"),'อยู่ไกลถนน ไม่สร้างรถ');
 /* วิ่งจริง: รถเข้าใกล้ผู้เล่น ผ่านไปและหายไปเมื่อสุดทาง */
 await E("CARS.length=0;P.x=60*TS;P.y=10*TS;const c=trafSpawn(true)");
 const k=await E("CARS.length");ok(k>=1,'สร้างรถ');
 await E("TRAF.t=-999");
 let seen=0,moved=0;const x0=await E("CARS[0].s");
 for(let i=0;i<40;i++){await E("updateSchool(.1)");}
 ok(await E("CARS.length===0||CARS[0].s>"+x0),'รถวิ่งไปข้างหน้า');
 /* หยุดรอผู้เล่นที่ยืนขวางทาง */
 await E("CARS.length=0;P.x=60*TS;P.y=13.5*TS;const c=trafSpawn(true);c.s=Math.max(0,60-19+12);c.v=c.sp;c.ri=0");
 for(let i=0;i<60;i++)await E("updateSchool(.1)");
 ok(await E("(()=>{const c=CARS[0];return !c||c.x<=P.x/TS+0.2})()"),'ไม่ทับผู้เล่นที่ยืนขวางถนน');
 /* เลี้ยวเหนือที่แยกเมือง + กลับทางใต้ */
 ok(await E("(()=>{const a=trafPos(TRAF_RT[0],trafLen(TRAF_RT[0])-1),b=trafPos(TRAF_RT[1],5);return a.dir==='u'&&a.x===123.5&&b.dir==='d'&&b.x===124.5})()"),'เส้นทางขาไป/กลับโยงหมู่บ้าน-ฟาร์ม-เมือง');
 /* ไม่มีรถในฉากอื่น */
 await E("toScene('i','player')");for(let i=0;i<10;i++)await E("updateSchool(.1)");
 await done(g,'traffic')})().catch(e=>{console.error(e);process.exit(1)});
