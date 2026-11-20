// มินิเกมฟิตเนส: ช่วงเตรียมตัว กันกดค้าง/กดซ้ำ รับแต้มครั้งเดียว ปิดแล้วไม่ค้าง
const {boot,ok,done}=require('./lib');
(async()=>{const g=await boot(),{p,E,modal}=g;console.log('gym');
 await E('closeM();S.ill=0;S.full=100;S.energy=maxEn();S.fxd={d:S.day,n:0,r:0};gymPlay("lift")');
 await p.keyboard.press('Space');await p.waitForTimeout(1200);
 await p.keyboard.down('Space');await p.waitForTimeout(500);await p.keyboard.up('Space');
 for(let i=0;i<9;i++){await p.keyboard.press('Space');await p.waitForTimeout(260)}
 await p.waitForTimeout(300);ok((await modal()).includes('เกรด'),'เล่นครบรอบแล้วขึ้นเกรด');
 const f0=await E('S.fxd.n');await p.click('text=เสร็จแล้ว');await p.click('text=เสร็จแล้ว',{timeout:300}).catch(()=>{});await p.waitForTimeout(400);
 ok(await E('S.fxd.n')-f0===1,'กด "เสร็จแล้ว" ซ้ำ รับแต้มครั้งเดียว');
 await E('gymPlay("jog")');await p.waitForTimeout(900);await p.click('text=เลิกก่อน');await p.waitForTimeout(300);
 ok(await E('!M.classList.contains("on")'),'เลิกก่อนแล้วปิดหน้าต่าง');
 await done(g,'gym')})();
