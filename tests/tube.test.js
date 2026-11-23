const {boot,ok,done}=require('./lib');
const SP='/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/';
(async()=>{console.log('tube scenes');const g=await boot(),{E,p}=g;
 await E("closeM();S.day=5;S.min=11*60;S.rain=false;toScene('w');P.x=40*TS;P.y=12*TS;trafficTick=()=>{}");
 const kinds=['fps','race','farm','fish','food','craft','rpg','puz','horror','sim','talk'];
 const r=await p.evaluate(ks=>{const out=[];const cv=document.createElement('canvas');cv.width=320;cv.height=180;const c=cv.getContext('2d');
  const wrap=document.createElement('div');wrap.style.cssText='position:fixed;left:0;top:0;z-index:99999;background:#222;display:flex;flex-wrap:wrap;width:660px';document.body.append(wrap);
  ks.forEach(k=>{const c2=document.createElement('canvas');c2.width=320;c2.height=180;c2.style.width='160px';wrap.append(c2);try{__ev("tubeScene")(c2.getContext('2d'),3.3,k,'x');out.push(k+':ok')}catch(e){out.push(k+':'+e.message)}});return out},kinds);
 console.log(r.join(' '));ok(r.every(x=>x.endsWith(':ok')),'ทุกฉากวาดได้');
 await p.screenshot({path:SP+'scenes.png'});
 await p.evaluate(()=>document.body.lastChild.remove());
 ok(await E("tubeKind('🔫','x')==='fps'&&tubeKind('?','อาหาร')==='food'"),'จับคู่ประเภท');
 ok(await E("(closeM(),tvMenu(0),!document.querySelector('#modal').textContent.includes('ยูแสนสุข'))"),'ทีวีไม่มีช่องยูแสนสุข (ไปเล่นบนคอมพิวเตอร์/เว็บ)');
 /* หน้าไลฟ์/วิดีโอบนเว็บ */
 const lv=await E("(()=>{const b=webLiveW('i=0',()=>{});document.body.append(b);return !!b.querySelector('canvas')})()");ok(lv,'หน้าไลฟ์มีจอ');await p.waitForTimeout(500);
 const wv=await E("(()=>{const b=webWatch('f=0',()=>{});document.body.append(b);return !!b.querySelector('canvas')})()");ok(wv,'หน้าวิดีโอมีจอ');
 /* ถุงลม */
 await E("closeM();document.querySelectorAll('.ytw').forEach(e=>e.remove());WSOCK.length=0;wsockInit()");
 const n=await E("WSOCK.length");console.log('windsocks',n,await E("JSON.stringify(WSOCK)"));ok(n>=1,'มีถุงลมในโลก');
 await E("S.windOv={i:6,s:80};P.x=WSOCK[0].x*TS;P.y=(WSOCK[0].y+2)*TS");for(let i=0;i<60;i++)await E("updateSchool(.1)");await p.waitForTimeout(400);
 await p.screenshot({path:SP+'wsock.png'});
 await done(g,'tube')})().catch(e=>{console.error(e);process.exit(1)});
