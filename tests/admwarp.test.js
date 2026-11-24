const {boot,ok,done}=require('./lib');
(async()=>{console.log('admin warp + cave axe + bots');const g=await boot(),{E,p}=g;
 await E("closeM();admCat='warp';adminPanel()");await p.waitForTimeout(300);
 ok(await E("document.body.textContent.includes('วัดสุขใจ')&&document.body.textContent.includes('ถ้ำชั้น 10')"),'แท็บวาร์ปแสดงสถานที่/ถ้ำ');
 await E("admWarp(BID.temple)");ok(await E("scene==='w'&&Math.abs(P.x-(BID.temple.d+1)*TS)<1"),'วาร์ปไปวัด');
 await E("admWarpMine(5)");await p.waitForTimeout(300);ok(await E("scene==='m'&&MINE&&MINE.fl===5"),'วาร์ปลงถ้ำชั้น 5');
 await E("admWarp(BID.player)");ok(await E("scene==='w'&&!MINE"),'วาร์ปออกจากถ้ำไปบ้าน');
 /* ขวานในถ้ำ → สลับเป็นค้อน */
 await E("enterMine(2)");await p.waitForTimeout(300);
 await E("(()=>{const t=target();MINE.rocks.push({x:t.x,y:t.y,hp:3});S.hotbar=TOOLS.findIndex(q=>q.id==='axe');})()");
 await E("mineAutoTool()");ok(await E("TOOLS[S.hotbar].id")==='pick','ขวานหน้าก้อนหินในถ้ำ → สลับเป็นค้อนทุบหิน');
 const srv=require('fs').readFileSync(__dirname+'/../src/room.js','utf8');
 ok(/botFill\(me\)/.test(srv)&&/act === "botfill"/.test(srv)&&/botSeats\(\)/.test(srv)&&/b\.afk/.test(srv),'เซิร์ฟเวอร์มี botfill/AFK/ที่นั่ง');
 await done(g,'admwarp')})().catch(e=>{console.error(e);process.exit(1)});
