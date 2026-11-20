// ตัวช่วยกลางของชุดทดสอบ: สร้างสำเนาเกมที่เปิดตัวแปรภายใน (__ev) แล้วเปิดด้วย Chromium แบบไม่มีหน้าจอ (Playwright)
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const ROOT=path.join(__dirname,'..'),CORE=path.join(ROOT,'public/game-core/baan-suan-sukjai-core.html');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'bssj-test-'));
function inst(){const o=path.join(TMP,'core.html');cp.execFileSync('node',[path.join(__dirname,'mkinst.js'),CORE,o]);return o}
async function boot(opts={}){
 const {chromium}=require('playwright');const b=await chromium.launch();
 const p=await (await b.newContext({viewport:{width:660,height:500}})).newPage();const errs=[];p.on('pageerror',e=>errs.push(String(e).slice(0,300)));
 const html=fs.readFileSync(inst(),'utf8');
 await p.route(/x\.test\/api\//,r=>r.fulfill({json:{}}));
 await p.route('https://x.test/game.html',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));
 await p.goto('https://x.test/game.html');await p.waitForTimeout(800);
 if(opts.path)await p.click('#pathSeg [data-p='+opts.path+']');
 await p.click('#startBtn');await p.waitForTimeout(1300);
 for(let i=0;i<4;i++){await p.click('text=ข้าม',{timeout:700}).catch(()=>{});await p.waitForTimeout(250)}
 const E=s=>p.evaluate(x=>__ev(x),s);
 return {b,p,E,errs,modal:()=>p.evaluate(()=>(document.getElementById('modal')||{innerText:''}).innerText||'')};
}
let fails=0;
const ok=(c,msg)=>{console.log((c?'  ✔ ':'  ✘ ')+msg);if(!c)fails++};
const done=async(g,name)=>{ok(!g.errs.length,'ไม่มี error ในหน้าเกม'+(g.errs.length?': '+g.errs[0]:''));await g.b.close();console.log(name+': '+(fails?'ล้มเหลว '+fails+' ข้อ':'ผ่าน'));process.exit(fails?1:0)};
module.exports={boot,ok,done,ROOT,TMP,fails:()=>fails};
