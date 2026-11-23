const {boot,ok,done}=require('./lib');
const SP='/tmp/claude-0/-home-claude/914e2ec0-2c6c-50da-9245-985b207dee98/scratchpad/';
(async()=>{console.log('temperature');const g=await boot(),{E,p}=g;
 await E("closeM();toScene('w');P.x=40*TS;P.y=12*TS;trafficTick=()=>{}");
 const T=(d,h,r)=>E("(()=>{S.day="+d+";S.min="+h+"*60;S.rain="+!!r+";updateSchool(.1);return JSON.stringify(tempNow())})()").then(JSON.parse);
 const hot=await T(10,14,false),hotN=await T(10,5,false),rainy=await T(40,14,true),cold=await T(62,6,false),coldD=await T(62,14,false);
 console.log('ร้อนบ่าย',hot.t,hot.f,'ร้อนเช้ามืด',hotN.t,'ฝนบ่าย',rainy.t,rainy.hum,'หนาวเช้า',cold.t,cold.f,'หนาวบ่าย',coldD.t);
 ok(hot.t>=33&&hot.t<=42,'ฤดูร้อนบ่าย 33–42°');ok(hotN.t<hot.t-4,'เช้ามืดเย็นกว่าบ่าย');
 ok(rainy.t<hot.t-3&&rainy.hum>=80,'ฤดูฝน เย็นกว่า+ชื้นมาก');
 ok(cold.t<=20&&coldD.t>cold.t+4,'ฤดูหนาวเช้าหนาว บ่ายอุ่นขึ้น');
 ok(hot.f>=hot.t-1,'ร้อนชื้น รู้สึกร้อนกว่าจริง');
 /* ผลต่อพลังงาน */
 await E("S.day=10;S.min=14*60;S.rain=false;S.tempOv=41;S.energy=100;S.tw=null;updateSchool(.1);for(let i=0;i<10;i++)updateSchool(.1);WIND.s=0");
 await E("TEMPC=tempNow()");const m1=await E("tempMul()");await E("S.tempOv=26;TEMPC=tempNow()");const m2=await E("tempMul()");console.log('mul',m1,m2);
 ok(m1>=1.15&&m2===1,'ร้อนจัดเหนื่อยเร็ว/สบายปกติ');
 await E("S.tempOv=41;TEMPC=tempNow();S.energy=100;useEnergy(10)");const e1=await E("S.energy");await E("S.tempOv=26;TEMPC=tempNow();S.energy=100;useEnergy(10)");const e2=await E("S.energy");console.log('energy',e1,e2);ok(e1<e2,'ร้อนจัดใช้พลังงานมากกว่า');
 await E("S.tempOv=41;S.tw=null;TEMPC=tempNow();tempWarn()");await p.waitForTimeout(200);
 ok((await p.evaluate(()=>document.body.innerText)).includes('ร้อนจัด'),'เตือนร้อนจัด');
 await E("S.tempOv=41;S.min=13*60;TEMPC=tempNow();dirty=1");await p.waitForTimeout(600);await p.screenshot({path:SP+'heat.png'});
 /* หมอกเช้า */
 await E("delete S.tempOv;S.day=40;S.rain=false;S.min=6*60;TEMPC=tempNow();TEMPC.hum=90");await p.waitForTimeout(400);await p.screenshot({path:SP+'mist.png'});
 ok(await E("document.getElementById('hdWind').textContent.includes('°')"),'HUD แสดงอุณหภูมิ');
 await E("closeM();tvMenu(0)");const m=await g.modal();ok(m.includes('รู้สึกเหมือน')&&m.includes('ความชื้น'),'ทีวีแจ้งอุณหภูมิ/ความชื้น');
 await E("closeM();wxApp(document.createElement('div'))");ok(true,'แอพพยากรณ์ไม่ error');
 await done(g,'temp')})().catch(e=>{console.error(e);process.exit(1)});
