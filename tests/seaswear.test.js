const {boot,ok,done}=require('./lib');
const SP='/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/';
(async()=>{console.log('season wear');const g=await boot(),{E,p}=g;console.log("ERRS",g.errs);
 await E("closeM();S.outfit='casual';toScene('w');trafficTick=()=>{};P.x=40*TS;P.y=12*TS");
 const px=async(tag,set)=>{await E(set+";wxC.t=-9");await p.waitForTimeout(300);
  return E("(()=>{const out={};for(const [n,l] of [['pl',lookOf()],['npc',NPCS[0].look],['monk',MONKLOOK]]){const c=document.createElement('canvas');c.width=60;c.height=60;const x=c.getContext('2d');person(x,30,50,l,'d',0,2);out[n]=c.toDataURL()}out.k=wxNow();return JSON.stringify(out)})()").then(JSON.parse)};
 const n=await px('n',"S.rain=0;S.tempOv=26;TEMPC=tempNow()"),c=await px('c',"S.rain=0;S.tempOv=8;TEMPC=tempNow()"),h=await px('h',"S.rain=0;S.tempOv=38;TEMPC=tempNow()"),r=await px('r',"S.rain=1;S.tempOv=26;TEMPC=tempNow()");
 console.log(n.k,c.k,h.k,r.k);
 ok(n.k===''&&c.k==='cold'&&h.k==='hot'&&r.k==='rain','เลือกสถานะตามอากาศ');
 console.log(await E('S.outfit'),JSON.stringify(await E('lookOf()')));for(const w of ['pl','npc']){ok(n[w]!==c[w]&&n[w]!==h[w]&&n[w]!==r[w]&&c[w]!==h[w],w+' ชุดเปลี่ยนตามอากาศ')}
 ok(await E("(()=>{let a=0;for(const st of ['cold','hot','rain']){wxC.t=time;wxC.k=st;if(seasonWear(MONKLOOK,undefined))a++;for(const k of SK)if(k.t==='monk'&&seasonWear(k.look,k.look.fit))a++}wxC.t=-9;return a===0})()"),'พระไม่เปลี่ยนชุด (ทุกสถานะ ทุกรูป)');
 ok(await E("(()=>{wxC.t=time;wxC.k='cold';const r=seasonWear(NPCS[0].look,NPCS[0].look.fit);wxC.t=-9;return !!r&&r.k==='cold'})()"),'NPC ทั่วไปได้ชุดหนาว');
 await E("S.rain=0;S.tempOv=8;TEMPC=tempNow();wxC.t=-9");await p.waitForTimeout(500);await p.screenshot({path:SP+'sw_cold.png'});
 await E("S.tempOv=38;TEMPC=tempNow();wxC.t=-9");await p.waitForTimeout(500);await p.screenshot({path:SP+'sw_hot.png'});
 await E("S.rain=1;S.tempOv=26;TEMPC=tempNow();wxC.t=-9");await p.waitForTimeout(500);await p.screenshot({path:SP+'sw_rain.png'});
 await done(g,'seaswear')})().catch(e=>{console.error(e);process.exit(1)});
