// สคริปต์อัปเดตอัตโนมัติ (ใช้เซิร์ฟเวอร์จำลอง): ไม่ขึ้นแถบถ้าไม่มีอัปเดต/เน็ตหลุด • ขึ้นเมื่อเวอร์ชันเปลี่ยน • เลื่อน/รีเฟรชเลย/นับถอยหลัง
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),{ok,fails}=require('./lib');
(async()=>{console.log('auto-update');const b=await chromium.launch(),p=await (await b.newContext()).newPage();
 let v='A',fail=false,loads=0;const src=fs.readFileSync(path.join(__dirname,'../public/auto-update.js'),'utf8').replace('POLL=45000','POLL=1000').replace('LATER=180000','LATER=3000');
 await p.route('https://x.test/**',r=>{const u=r.request().url();
  if(u.endsWith('/api/ver'))return fail?r.abort():r.fulfill({json:{ok:true,v}});
  if(u.endsWith('/auto-update.js'))return r.fulfill({contentType:'text/javascript; charset=utf-8',body:src});
  loads++;return r.fulfill({contentType:'text/html; charset=utf-8',body:'<html><meta charset=utf-8><body>hi<script src="/auto-update.js"></script></body></html>'})});
 const bar=()=>p.locator('[role=status]').count();
 await p.goto('https://x.test/');await p.waitForTimeout(1500);ok(await bar()===0,'ไม่มีอัปเดต → ไม่ขึ้นแถบ');
 fail=true;v='B';await p.waitForTimeout(2500);ok(await bar()===0,'เน็ตหลุด → ไม่ขึ้นแถบ');
 fail=false;await p.waitForTimeout(1800);ok(await bar()===1,'เน็ตกลับ + มีเวอร์ชันใหม่ → ขึ้นแถบ');
 await p.click('text=เลื่อน');ok(await bar()===0,'กดเลื่อนแล้วแถบหาย');await p.waitForTimeout(5500);ok(await bar()===1,'เลื่อนแล้วเตือนใหม่');
 const l0=loads;await p.click('text=รีเฟรชเลย');await p.waitForTimeout(1500);ok(loads>l0,'รีเฟรชเลย → โหลดหน้าใหม่');
 await p.waitForTimeout(1500);v='C';await p.waitForTimeout(2500);const l1=loads;await p.waitForTimeout(11500);ok(loads>l1,'ครบ 10 วินาที → รีเฟรชเอง');
 await b.close();console.log('auto-update: '+(fails()?'ล้มเหลว '+fails()+' ข้อ':'ผ่าน'));process.exit(fails()?1:0)})().catch(e=>{console.error(e);process.exit(1)});
