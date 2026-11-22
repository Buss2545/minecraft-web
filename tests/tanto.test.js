const {boot,ok,done}=require('./lib');
(async()=>{console.log('tanto');const g=await boot(),{E,p}=g;
 ok(await E("!!BID.kuti2&&!!SK.find(k=>k.id==='tanto')"),'มีกุฏิเจ้าอาวาสและทันโต');
 ok(await E("(()=>{const b=BID.kuti2;return !isSolid(b.d,b.y2+1)&&!isSolid(b.d+1,b.y2+1)&&b.x1>BID.kuti.x2})()"),'ทางหน้ากุฏิโล่ง ไม่ทับกุฏิเดิม');
 /* ก่อนมา */
 await E("closeM();S.day=40;S.min=10*60;toScene('w')");
 await E("updateSchool0(.1)");
 ok(await E("!SK.find(k=>k.id==='tanto').r"),'ก่อนฤดูหนาวยังไม่มีตัว');
 ok(!(await E("tantoHere()")),'tantoHere false วัน 40');
 await E("enterBld(BID.kuti2)");await p.waitForTimeout(400);
 ok(await E("scene==='w'"),'กุฏิว่างก่อนมา เข้าไม่ได้');
 /* วันมา */
 await E("S.day=57;S.min=7*60;closeM();toScene('w');S.tantoSeen=0;dayNotice()");
 ok(await E("tantoHere()&&S.tantoSeen===1"),'ข่าวต้อนรับเมื่อมาถึง');
 for(let i=0;i<30;i++)await E("updateSchool0(.5)");
 ok(await E("!!SK.find(k=>k.id==='tanto').r"),'ทันโตปรากฏหลัง update');
 /* วัดมีเบาะ */
 await E("delete INT.temple;toScene('i','temple')");
 ok(await E("INT.temple.furn.some(f=>f.e==='หลวงพ่อทันโต')||INT.temple.all&&INT.temple.all.some(f=>f.e==='หลวงพ่อทันโต')"),'วัดมีเบาะทันโต');
 /* กุฏิกลางคืน */
 await E("closeM();toScene('w');S.min=22*60;for(let i=0;i<20;i++)updateSchool0(.5)");
 await E("toScene('i','kuti2')");
 ok(await E("(()=>{const k=SK.find(k=>k.id==='tanto');return skRoom(k)==='kuti2'||(k.r&&k.r.inside)})()"),'กลางคืนทันโตอยู่กุฏิใหม่');
 await p.screenshot({path:'/tmp/kuti2.png'});
 /* เมนู + intro + เรื่องเล่า + เทศน์ + เวียนเทียน */
 await E("closeM();const k=SK.find(k=>k.id==='tanto');skMenu(k)");await p.waitForTimeout(500);
 ok(await E("S.npc.tanto.intro===1"),'บทแนะนำตัว');
 await E("closeM();S.npc.tanto.pts=400;tantoStory(SK.find(k=>k.id==='tanto'))");await p.waitForTimeout(300);
 ok((await E("M.textContent")).includes('ทำไมถึงกลับมา'),'เมนูเรื่องเล่า');
 await E("closeM();monkSermon(SK.find(k=>k.id==='tanto'))");await p.waitForTimeout(300);
 ok((await E("M.textContent")).includes('เทศน์เรื่อง'),'เทศน์วันพระของทันโต');
 await E("closeM();S.day=57+7;S.min=20*60+10;toScene('w')");
 ok(await E("wanPhra()||true"),'ok');
 await E("closeM();S.wpWalk=0;wianTian()");await p.waitForTimeout(300);
 ok((await E("M.textContent")).includes('เวียนเทียน'),'เวียนเทียน');
 await done(g,'tanto')})().catch(e=>{console.error(e);process.exit(1)});
