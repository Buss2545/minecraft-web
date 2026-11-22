const {boot,ok,done}=require('./lib');
(async()=>{console.log('tanto2');const g=await boot(),{E,p}=g;
 /* 2. ปฏิทิน/วันสำคัญ */
 ok(await E("(()=>{S.day=SL+2;return budToday()&&budToday().k==='khao'})()"),'เข้าพรรษา ฝนวันที่ 2');
 ok(await E("(()=>{S.day=SL+28;return budToday()&&budToday().k==='ok'})()"),'ออกพรรษา ฝนวันที่ 28');
 ok(await E("(()=>{S.day=SL+2;return calText(2).includes('เข้าพรรษา')})()"),'ปฏิทินบอกวัน');
 /* เทียนพรรษา */
 await E("closeM();S.day=SL+2;S.min=10*60;S.money=500;toScene('w');S.budSeen=0;dayNotice()");
 ok(await E("S.budSeen===S.day"),'แจ้งเตือนวันสำคัญ');
 const items=await E("templeExtra().map(i=>i.t)");console.log(items.join(' | '));
 ok(items.some(t=>t.includes('เทียนพรรษา')),'มีเมนูเทียนพรรษา');
 await E("templeExtra().find(i=>i.t.includes('เทียนพรรษา')).fn()");await p.waitForTimeout(300);
 for(let i=0;i<4;i++){await E("document.querySelector('#modal button.big, .card button.big, .card button')&&0");}
 await E("(()=>{const m0=S.money;closeM();S.budDay=0;S.money=500;const k=preacherK();S.npc[k.id].pts=0;return 0})()");
 /* ตักบาตรเทโว */
 await E("closeM();S.day=SL+28;S.min=7*60;S.almsDay=0;addInv('crop:rice',2)");
 ok(await E("templeExtra().some(i=>i.t.includes('เทโว')&&!i.dis)"),'ตักบาตรเทโว เปิดได้');
 /* 1. วันพระ ช่วยดอกไม้/เพล */
 await E("closeM();S.day=8;S.min=9*60;S.wpFlow=0;S.wpFood=0;addInv('for:lotus',1);addInv('food:'+RECIPES.find(r=>!r.sec).id,1)");
 const wp=await E("templeExtra().map(i=>i.t+(i.dis?'[X]':''))");console.log(wp.join(' | '));
 ok(wp.some(t=>t.includes('ดอกไม้')&&!t.includes('[X]')),'ช่วยจัดดอกไม้ ใช้ได้');
 await E("templeExtra().find(i=>i.t.includes('ดอกไม้')).fn()");
 ok(await E("S.wpFlow===S.day&&have('for:lotus')===0"),'ใช้ดอกไม้ 1 และบันทึกวัน');
 /* 3. ทันโตสอนเด็ก */
 await E("closeM();S.day=SL*2+3;toScene('w')");
 const wd=await E("(()=>{for(let d=SL*2+3;d<SL*2+12;d++){S.day=d;if(dow()===2&&!festToday())return d}return 0})()");
 await E("S.min=13*60+40;closeM();toScene('w')");
 ok(await E("tantoSchool()"),'พุธบ่าย ทันโตไปโรงเรียน');
 for(let i=0;i<40;i++)await E("updateSchool0(.5)");
 await E("toScene('i','school')");await p.waitForTimeout(400);await p.screenshot({path:'/tmp/tschool.png'});
 await E("skMenu(SK.find(k=>k.id==='tanto'))");await p.waitForTimeout(500);
 await E("closeM();S.npc.tanto.intro=1;skMenu(SK.find(k=>k.id==='tanto'))");await p.waitForTimeout(400);
 ok((await E("M.textContent")).includes('ฟังธรรมะสอนเด็ก'),'เมนูฟังสอนเด็กในโรงเรียน');
 await E("closeM();tantoLesson(SK.find(k=>k.id==='tanto'))");await p.waitForTimeout(300);
 ok((await E("M.textContent")).includes('ธรรมะเด็ก'),'บทเรียนเด็ก');
 /* 4. ของที่ระลึก */
 await E("closeM();S.min=10*60;toScene('w');S.npc.tanto.pts=800;S.npc.tanto.intro=1");
 await E("skMenu(SK.find(k=>k.id==='tanto'))");await p.waitForTimeout(400);
 ok((await E("M.textContent")).includes('ของที่ระลึก'),'เมนูของที่ระลึก');
 await E("closeM();const k=SK.find(k=>k.id==='tanto');S.npc.tanto.souv=0;");
 /* เซฟรอบเดียวไม่หาย */
 ok(await E("(()=>{S.wpFlow=77;S.tsDay=5;const d=normState(JSON.parse(JSON.stringify(S)));return d.wpFlow===77&&d.tsDay===5})()"),'ค่าสถานะผ่าน normState');
 ok(await E("!!info('sinjin')&&!!info('bodhi')"),'ไอเท็มที่ระลึกมีข้อมูล');
 await done(g,'tanto2')})().catch(e=>{console.error(e);process.exit(1)});
