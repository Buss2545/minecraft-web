const {boot,ok,done}=require('./lib');
const SP='/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/';
(async()=>{console.log('idle anims');const g=await boot(),{E,p}=g;
 await E("closeM();toScene('w');P.x=40*TS;P.y=12*TS;trafficTick=()=>{}");
 const ch=(d,h,r,ov)=>E("(()=>{S.day="+d+";S.min="+h+"*60;S.rain="+!!r+";"+(ov==null?"delete S.tempOv":"S.tempOv="+ov)+";TEMPC=tempNow();return idleChoices().join()})()");
 const cold=await ch(62,6,false),hot=await ch(10,14,false),rain=await ch(40,18,true);console.log(cold,'|',hot,'|',rain);
 ok(cold.includes('shiver')&&cold.includes('sneeze')&&!cold.includes('fan'),'หนาว→สั่น/จาม');
 ok(hot.includes('fan')&&!hot.includes('shiver'),'ร้อน→โบกพัด');
 ok(rain.includes('mosq'),'ฝน/เย็น→ยุงกัด');
 /* ทุกท่า: ไม่ error และ id ตรงกับ room.js */
 const ids=await E("JSON.stringify(Object.keys(IDLE_POSES))").then(JSON.parse);
 const fs=require('fs'),room=fs.readFileSync(__dirname+'/../src/room.js','utf8');
 ok(ids.every(k=>k==='drowsy'||room.includes('"i_'+k+'"')),'room.js รู้จักทุกท่า');
 ok(ids.every(k=>room.includes('"i_'+k+'"')),'ทุกท่าส่งหาเพื่อนได้');
 for(const k of ids){await E("S.day=62;S.min=6*60;S.tempOv=8;TEMPC=tempNow();IDL.k='"+k+"';IDL.t0=time");
  for(const t of [.5,1.5,2.5,3.5]){const r=await E("(()=>{const o=idlePose('"+k+"',"+t+");const c=document.createElement('canvas').getContext('2d');if(o.fx)idleFx(c,50,50,o.fx);return 1})()");ok(r===1,k+' t='+t)}
  await p.waitForTimeout(350);
  if(k==='shiver'||k==='mosq')await p.screenshot({path:SP+'idle_'+k+'.png'});
  await E("IDL.k=null")}
 /* tick เลือกท่าใหม่ได้จริงเมื่อยืนนิ่ง */
 await E("S.tempOv=8;TEMPC=tempNow();P.moving=false;IDL.k=null;IDL.t=99;IDL.n=0");await p.waitForTimeout(500);
 ok(await E("!!IDL.k||IDL.last!==null||IDL.n>0"),'ยืนนิ่งแล้วเริ่มท่าเอง');
 await done(g,'idle')})().catch(e=>{console.error(e);process.exit(1)});
