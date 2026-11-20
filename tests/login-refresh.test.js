// กดเข้าสู่ระบบสำเร็จ → รีเฟรช 1 ครั้ง (ไม่วนซ้ำ) • รหัสผิด → ไม่รีเฟรช (เซิร์ฟเวอร์จำลอง)
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),{ok,fails}=require('./lib');
(async()=>{console.log('login-refresh');const b=await chromium.launch(),p=await (await b.newContext()).newPage();
 let logged=false,loads=0,good=false;const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 await p.route('https://x.test/**',r=>{const u=r.request().url();
  if(u.includes('/api/auth/login'))return r.fulfill({json:good?(logged=true,{ok:true,user:{uid:'u1',username:'tester',role:'user'}}):{ok:false,err:'cred'}});
  if(u.includes('/api/auth/me'))return r.fulfill({json:{ok:true,user:logged?{uid:'u1',username:'tester',role:'user'}:null,adminReady:false,ownerReady:false}});
  if(u.includes('/api/'))return r.fulfill({json:{ok:true}});
  if(u.endsWith('/')||u.endsWith('/index.html')){loads++;return r.fulfill({contentType:'text/html; charset=utf-8',body:html})}
  return r.fulfill({status:204,body:''})});
 await p.goto('https://x.test/');await p.waitForTimeout(800);
 await p.click('#acBtn,[id*=ac][id$=Btn],#acAv',{timeout:3000}).catch(()=>{});await p.waitForTimeout(500);
 await p.fill('input[autocomplete=username]','tester').catch(()=>{});await p.fill('input[type=password]','password123').catch(()=>{});
 const l0=loads;await p.click('button.go[type=submit]');await p.waitForTimeout(1200);ok(loads===l0,'รหัสผิด → ไม่รีเฟรช');
 good=true;await p.click('button.go[type=submit]');await p.waitForTimeout(2500);ok(loads===l0+1,'เข้าสู่ระบบสำเร็จ → รีเฟรช 1 ครั้ง');
 await p.waitForTimeout(2000);ok(loads===l0+1,'หลังรีเฟรชไม่วนซ้ำ');
 await b.close();console.log('login-refresh: '+(fails()?'ล้มเหลว':'ผ่าน'));process.exit(fails()?1:0)})().catch(e=>{console.error(e);process.exit(1)});
