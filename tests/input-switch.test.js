// สลับอุปกรณ์ควบคุมอัตโนมัติ: แตะจอ → touch • กดคีย์ → kbd • ขยับเมาส์หลังแตะ → kbd • จอยกดปุ่ม → pad • แตะอีกที → touch • จอยหลุด → กลับโหมดเดิม
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),cp=require('child_process'),{ok,fails,TMP}=require('./lib');
(async()=>{console.log('input-switch');
 const out=path.join(TMP,'core.html');cp.execFileSync('node',[path.join(__dirname,'mkinst.js'),path.join(__dirname,'../public/game-core/baan-suan-sukjai-core.html'),out]);
 const html=fs.readFileSync(out,'utf8');const b=await chromium.launch();
 const ctx=await b.newContext({viewport:{width:800,height:500},hasTouch:true});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(String(e).slice(0,200)));
 await p.addInitScript(()=>{window.__pad=null;navigator.getGamepads=()=>[window.__pad]});
 await p.route(/x\.test\/api\//,r=>r.fulfill({json:{}}));await p.route('https://x.test/game.html',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));
 await p.goto('https://x.test/game.html');await p.waitForTimeout(800);await p.click('#startBtn');await p.waitForTimeout(1300);
 for(let i=0;i<4;i++){await p.click('text=ข้าม',{timeout:700}).catch(()=>{});await p.waitForTimeout(250)}
 const cl=()=>p.evaluate(()=>[...document.getElementById('app').classList].filter(c=>['kbd','pad','touchin'].includes(c)).join());
 await p.touchscreen.tap(400,200);await p.waitForTimeout(200);ok(await cl()==='touchin','แตะจอ → โหมดสัมผัส');
 await p.keyboard.press('KeyD');await p.waitForTimeout(200);ok(await cl()==='kbd','กดคีย์ → โหมดคีย์บอร์ด');
 await p.touchscreen.tap(400,200);await p.waitForTimeout(200);ok(await cl()==='touchin','แตะจอ → กลับโหมดสัมผัส');
 await p.mouse.move(300,300);await p.mouse.move(340,320);await p.waitForTimeout(200);ok(await cl()==='kbd','ขยับเมาส์ → โหมดคีย์บอร์ด');
 await p.evaluate(()=>{window.__pad={connected:true,id:'Test Pad',mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}});await p.waitForTimeout(600);
 await p.evaluate(()=>{window.__pad.buttons[0]={pressed:true,value:1}});await p.waitForTimeout(500);ok(await cl()==='pad','จอยกดปุ่ม → โหมดจอย');
 await p.evaluate(()=>{window.__pad.buttons[0]={pressed:false,value:0}});await p.mouse.move(500,300);await p.mouse.move(520,310);await p.waitForTimeout(300);ok(await cl()==='pad','ขยับเมาส์เบาๆ ตอนใช้จอย → ไม่สลับ');
 await p.keyboard.press('KeyD');await p.waitForTimeout(200);ok(await cl()==='kbd','กดคีย์ตอนใช้จอย → โหมดคีย์บอร์ด');
 await p.evaluate(()=>{window.__pad.buttons[0]={pressed:true,value:1}});await p.waitForTimeout(400);ok(await cl()==='pad','จอยกดอีกครั้ง → โหมดจอย');
 const op=await p.evaluate(()=>getComputedStyle(document.getElementById('joy')).opacity);ok(+op<.3,'โหมดจอย: ปุ่มบนจอจางลง');
 await p.touchscreen.tap(400,200);await p.waitForTimeout(500);ok(await cl()==='touchin','แตะจอตอนใช้จอย → โหมดสัมผัส');
 await p.evaluate(()=>{window.__pad.buttons[0]={pressed:false,value:0}});await p.waitForTimeout(200);await p.evaluate(()=>{window.__pad.buttons[0]={pressed:true,value:1}});await p.waitForTimeout(400);ok(await cl()==='pad','กดจอยใหม่ → โหมดจอย');
 await p.evaluate(()=>{window.__pad=null});await p.waitForTimeout(600);ok(await cl()==='touchin','จอยหลุด → กลับโหมดเดิม (สัมผัส)');
 ok(!errs.length,'ไม่มี error'+(errs[0]?': '+errs[0]:''));
 await b.close();console.log('input-switch: '+(fails()?'ล้มเหลว '+fails():'ผ่าน'));process.exit(fails()?1:0)})().catch(e=>{console.error(e);process.exit(1)});
