// ออกจากระบบ → รีเฟรช 1 ครั้ง • กด "อันดับ/เพื่อน" → รีเฟรช 1 ครั้งแล้วเปิดกล่องเอง (ไม่วน) • เน็ตหลุด → เปิดเลยไม่รีเฟรช
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),{ok,fails}=require('./lib');
(async()=>{console.log('logout-lb-refresh');const b=await chromium.launch(),p=await (await b.newContext()).newPage();
 let loads=0,net=true,user=true;const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 await p.route('https://x.test/**',r=>{const u=r.request().url();
  if(u.includes('/api/ver'))return net?r.fulfill({json:{ok:true,v:'A'}}):r.abort();
  if(u.includes('/api/auth/logout')){user=false;return r.fulfill({json:{ok:true}})}
  if(u.includes('/api/auth/me'))return r.fulfill({json:{ok:true,user:user?{uid:'u1',username:'tester',role:'user'}:null,adminReady:false,ownerReady:false}});
  if(u.includes('/api/'))return r.fulfill({json:{ok:true,friends:[],incoming:[],outgoing:[],lists:{}}});
  if(u.endsWith('/')||u.endsWith('/index.html')){loads++;return r.fulfill({contentType:'text/html; charset=utf-8',body:html})}
  return r.fulfill({status:204,body:''})});
 await p.goto('https://x.test/');await p.waitForTimeout(800);
 let l=loads;await p.click('#lbBtn');await p.waitForTimeout(1500);
 ok(loads===l+1,'กดอันดับ/เพื่อน → รีเฟรช 1 ครั้ง');ok(await p.evaluate(()=>document.getElementById('lbDlg').open),'รีเฟรชแล้วกล่องเปิดเอง');
 await p.waitForTimeout(1500);ok(loads===l+1,'ไม่วนรีเฟรชซ้ำ');
 await p.click('#lbX');net=false;l=loads;await p.click('#lbBtn');await p.waitForTimeout(1200);
 ok(loads===l&&await p.evaluate(()=>document.getElementById('lbDlg').open),'เน็ตหลุด → เปิดกล่องเลย ไม่รีเฟรช');
 await p.click('#lbX');net=true;
 await p.click('#acBtn');await p.waitForTimeout(800);
 l=loads;await p.click('.tabs button:has-text("บัญชี")',{timeout:3000});await p.click('button:has-text("ออกจากระบบ")',{timeout:3000});await p.waitForTimeout(1800);ok(loads===l+1,'ออกจากระบบ → รีเฟรช 1 ครั้ง');
 await p.waitForTimeout(1500);ok(loads===l+1,'หลังรีเฟรชไม่วนซ้ำ');
 await b.close();console.log('logout-lb-refresh: '+(fails()?'ล้มเหลว':'ผ่าน'));process.exit(fails()?1:0)})().catch(e=>{console.error(e);process.exit(1)});
