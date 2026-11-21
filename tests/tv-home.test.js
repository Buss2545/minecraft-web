// ทีวีในบ้าน (พยากรณ์ • ข่าว • ดวง) + ราคาโทรศัพท์ถูกลง
const {boot,ok,done}=require('./lib');
(async()=>{console.log('tv-home');const g=await boot(),{E,p}=g;
 for(const hl of [0,1,2,3]){ok(await E("(()=>{S.houseLv="+hl+";delete INT.player;const o=mkInt('player');return o.furn.some(f=>f.t==='tv')&&(()=>{const t=o.furn.find(f=>f.t==='tv');return t.x===4&&t.y===6&&!o.furn.some(f=>f!==t&&f.t!=='window'&&f.t!=='rug'&&!(f.x+f.w<=t.x||f.x>=t.x+t.w||f.y+f.h<=t.y||f.y>=t.y+t.h))})()})()"),'บ้านระดับ '+hl+': มีทีวีข้างกล่องหีบ (3,6) ไม่ซ้อนเฟอร์นิเจอร์อื่น')}
 await E("closeM();S.energy=50;S.tvDay=-1;S.day=3;tvMenu(0)");await p.waitForTimeout(500);
 let m=await E("M.textContent");ok(m.includes('พยากรณ์ล่วงหน้า')&&m.includes('พรุ่งนี้')&&m.includes('อีก 4 วัน'),'ช่องพยากรณ์อากาศ: วันนี้ + ล่วงหน้า');
 ok(await E("S.energy")===55&&m.includes('พลังงาน +5'),'ดูครั้งแรกของวัน พลังงาน +5');
 await E("tvMenu(1)");await p.waitForTimeout(300);m=await E("M.textContent");ok(m.includes('ข่าวเด่น'),'ช่องข่าวแสดงข่าวประจำวัน');
 await E("tvMenu(2)");await p.waitForTimeout(300);m=await E("M.textContent");ok(m.includes('ดวงประจำวัน')&&m.includes('การเกษตร')&&m.includes('เลขเด็ด')&&m.includes('โชคถ้ำ'),'ช่องดวง/โชค');
 ok(await E("S.energy")===55,'เปิดซ้ำวันเดียวกันไม่ได้พลังงานเพิ่ม');
 const a=await E("JSON.stringify(tvLuck())");await E("S.day=4");const b=await E("JSON.stringify(tvLuck())");ok(a!==b,'ดวงเปลี่ยนตามวัน');
 await E("S.day=3");ok(await E("JSON.stringify(tvLuck())")===a,'วันเดิมดวงเท่าเดิม');
 await E("closeM();S.money=1000;S.inv={};shop('phone','buy')");await p.waitForTimeout(500);m=await E("M.textContent");ok(m.includes('โทรศัพท์มือถือ')&&m.includes('500')&&!m.includes('1200'),'ราคาโทรศัพท์ ฿500');
 await done(g,'tv-home')})().catch(e=>{console.error(e);process.exit(1)});
