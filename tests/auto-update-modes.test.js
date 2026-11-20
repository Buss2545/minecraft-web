// แถบแจ้งเตือนอัปเดต: เล่นคนเดียว (solo) กับ ออนไลน์ (?room=) ต้องขึ้นเหมือนกัน + หน้าแยกจอมีสคริปต์
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),{ok,fails,ROOT}=require('./lib');
(async()=>{console.log('auto-update-modes');const b=await chromium.launch();
 const core=fs.readFileSync(path.join(ROOT,'public/game-core/baan-suan-sukjai-core.html'),'utf8');
 const au=fs.readFileSync(path.join(ROOT,'public/auto-update.js'),'utf8').replace('POLL=45000','POLL=800');
 ok(fs.readFileSync(path.join(ROOT,'public/game-core/split.html'),'utf8').includes('/auto-update.js'),'หน้าแยกจอมี auto-update.js');
 for(const q of ['','?room=ABCD&mode=online']){
  const p=await (await b.newContext({viewport:{width:660,height:500}})).newPage();let v='A',loads=0;
  await p.route('https://x.test/**',r=>{const u=r.request().url();
   if(u.includes('/api/ver'))return r.fulfill({json:{ok:true,v}});
   if(u.endsWith('/auto-update.js'))return r.fulfill({contentType:'text/javascript; charset=utf-8',body:au});
   if(u.includes('/game.html')){loads++;return r.fulfill({contentType:'text/html; charset=utf-8',body:core})}
   if(u.includes('/api/'))return r.fulfill({json:{}});return r.fulfill({status:204,body:''})});
  await p.goto('https://x.test/game.html'+q);await p.waitForTimeout(1500);
  await p.click('#startBtn',{timeout:2000}).catch(()=>{});await p.waitForTimeout(1000);
  const n=()=>p.locator('[role=status]:has-text("เวอร์ชันใหม่")').count();
  ok(await n()===0,(q?'ออนไลน์':'คนเดียว')+': ยังไม่อัปเดต → ไม่ขึ้นแถบ');
  v='B';await p.waitForTimeout(2200);ok(await n()===1,(q?'ออนไลน์':'คนเดียว')+': มีเวอร์ชันใหม่ → ขึ้นแถบกลางเกม');
  const l0=loads;await p.click('text=รีเฟรชเลย');await p.waitForTimeout(1500);ok(loads>l0,(q?'ออนไลน์':'คนเดียว')+': กดรีเฟรชเลย → โหลดหน้าใหม่');
  await p.close()}
 await b.close();console.log('auto-update-modes: '+(fails()?'ล้มเหลว '+fails():'ผ่าน'));process.exit(fails()?1:0)})().catch(e=>{console.error(e);process.exit(1)});
