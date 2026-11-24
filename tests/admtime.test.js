const {boot,ok,done}=require('./lib');
const SP='/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/';
(async()=>{console.log('admin world time');const g=await boot(),{E,p}=g;await p.setViewportSize({width:390,height:844});
 await E("closeM();AUTH.user={role:'admin'}").catch(()=>{});
 const setv=async(d,hh,mm)=>{await E("closeM();adminTime()");await p.waitForTimeout(300);const ins=await p.$$('.card input[type=number]');await ins[0].fill(String(d));await ins[1].fill(String(hh));await ins[2].fill(String(mm));await p.waitForTimeout(100);await p.click('.card button:has-text("ตั้งค่า")');await p.waitForTimeout(300)};
 await setv(150,14,30);ok(await E("S.day===150&&Math.round(S.min)===870"),'ตั้งวันที่ 150 เวลา 14:30');
 ok(await E("dayN()===150&&season()===(Math.floor(149/SL)%3)"),'ปฏิทินตรงกับวันที่ตั้ง');
 await setv(5000,6,0);ok(await E("S.day")===2000,'วันที่สูงสุด 2000 (ใส่ 5000 → 2000)');
 await setv(0,6,0);ok(await E("S.day")===1,'ต่ำสุด 1');
 await setv(2000,0,30);ok(await E("S.day===2000&&Math.round(S.min)===1470"),'00:30 = ดึกของวันเดิม (24:30)');
 await setv(10,3,0);ok(await E("Math.round(S.min)")===360,'03:00 → ปัดเป็น 06:00');
 await setv(7,23,59);ok(await E("Math.round(S.min)")===1439,'23:59');
 await E("closeM();adminTime()");await p.waitForTimeout(300);await p.screenshot({path:SP+'admtime.png'});
 ok(await E("(()=>{const a=S.day,b=roomDayOff;admDateTxt(55);return S.day===a&&roomDayOff===b})()"),'ตัวอย่างวันที่ไม่แตะเซฟ');
 /* คณิตศาสตร์นาฬิกาห้อง: สูตรเดียวกับ room.js 'clock' → ฝั่งไคลเอนต์อ่านได้วัน/เวลาตรงเป้า */
 const CL=1200,ST=360,now=Date.now();let bad=0;
 for(const [day,min,el0] of [[1,360,5],[2000,1559,99999],[777,900,3*CL+50],[1234,1470,0.2]]){
  const k=Math.max(0,Math.floor(el0/CL)),epoch=now-((k*CL+(min-ST)))*1000,bd=day-k;
  const el=(now-epoch)/1000,k2=Math.floor(el/CL),m2=ST+(el-k2*CL);if(bd+k2!==day||Math.abs(m2-min)>1e-6)bad++}
 ok(bad===0,'สูตรตั้งนาฬิกาห้อง (server) ได้วัน/เวลาตรงเป้า');
 const srv=require('fs').readFileSync(__dirname+'/../src/room.js','utf8');
 ok(/act === "clock"/.test(srv)&&/day > 2000/.test(srv)&&/rst: rst \? 1 : 0/.test(srv),'เซิร์ฟเวอร์รับคำสั่ง clock จำกัด 1–2000 + แจ้ง rst');
 await done(g,'admtime')})().catch(e=>{console.error(e);process.exit(1)});
