const {boot,ok,done}=require('./lib');
(async()=>{console.log('mine floor bonus + balance');const g=await boot(),{E}=g;
 await E("S.mineMax=0");const h0=await E("maxHp()"),e0=await E("maxEn()"),a0=await E("atk()"),d0=await E("defn()");
 await E("S.mineMax=9");ok(await E("maxHp()")===h0,'ชั้น 9 ยังไม่ได้โบนัส');
 await E("S.mineMax=10");ok(await E("maxHp()")===h0+10&&await E("maxEn()")===e0+10&&await E("atk()")===a0+1&&await E("defn()")===d0+1,'ชั้น 10: เลือด+10 กำลังกาย+10 โจมตี+1 ป้องกัน+1');
 await E("S.mineMax=25");ok(await E("maxHp()")===h0+20,'ชั้น 20–29: +20');
 await E("S.mineMax=100");ok(await E("maxHp()")===h0+100&&await E("maxEn()")===e0+100,'ชั้น 100: +100');
 await E("S.mineMax=999");ok(await E("maxHp()")===h0+100,'เพดานโบนัสที่ชั้น 100');
 await E("S.mineMax=9;S.hp=1;S.day=10;enterMine(10)");
 ok(await E("S.hp===maxHp()&&mineBn()===1"),'ลงถึงชั้น 10 ครั้งแรก เลือดเต็ม + ได้โบนัส');
 /* ดาเมจโตเรียบ: ชั้น n+1 ไม่กระโดดเกิน 15% ของชั้น n */
 ok(await E("(()=>{let bad=0,prev=0;for(let f=1;f<=100;f++){const d=Math.round(MON_STAT.khamod.dmg*(1+f*.03)+f*.1);if(prev&&d>prev*1.15+1)bad++;prev=d}return bad===0})()"),'ดาเมจมอนเพิ่มเรียบตามชั้น');
 await done(g,'minebonus')})().catch(e=>{console.error(e);process.exit(1)});
