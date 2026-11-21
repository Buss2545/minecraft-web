// พระ: เมนูธรรมะ/พระวินัย/เทศน์วันพระ + กฎถวายของหลังเที่ยง
const {boot,ok,done}=require('./lib');
(async()=>{const g=await boot(),{p,E,modal}=g;console.log('monk');
 await E('closeM();S.rain=0;for(let q=0;q<40&&(!wanPhra()||festToday());q++)S.day++;S.min=18.5*60');
 ok(await E('wanPhra()'),'เจอวันพระ');
 await E('const k=SK.find(q=>q.id==="suk");k.r={inside:"temple",loc:"in"};skMenu(k)');await p.waitForTimeout(700);
 const t=await modal();ok(t.includes('ขอฟังธรรม')&&t.includes('พระวินัย')&&t.includes('ฟังเทศน์'),'เมนูพระมีธรรมะ/วินัย/เทศน์ (18:30 วันพระ)');
 await E('closeM();monkSermon(SK.find(q=>q.id==="suk"))');await p.waitForTimeout(700);
 for(let i=0;i<3;i++){await p.click('text=ต่อไป');await p.waitForTimeout(500)}
 await p.click('text=กราบขอบพระคุณ');await p.waitForTimeout(300);ok(await E('S.wpDay===S.day'),'ฟังเทศน์จบ ได้ผลวันพระ');
 await E('closeM();S.min=15*60;S.npc.suk.gifted=false;addInv("crop:chili",1);addInv("milk",1);giftPick(SK.find(q=>q.id==="suk"))');await p.waitForTimeout(500);
 const pm=await modal();ok(pm.includes('นมวัว')&&!pm.includes('พริก'),'หลังเที่ยงรับเฉพาะน้ำปานะ (นม) ไม่รับของกิน');
 await E('closeM();S.min=9*60;S.npc.suk.gifted=false;giftPick(SK.find(q=>q.id==="suk"))');await p.waitForTimeout(500);
 ok((await modal()).includes('พริก'),'ช่วงเช้าถวายของกินได้');
 // ใส่บาตรด้วยของในกระเป๋า (ไม่เสียเงิน): เลือก ข้าว/กับข้าว/ผลไม้ → มินิเกม → ของถูกหักออก ไม่หักเงิน
 await E('closeM();S.min=6*60;S.almsDay=-1;S.money=500;S.inv={};almsPick(SK.find(q=>q.id==="suk"))');await p.waitForTimeout(500);
 ok((await modal()).includes('ไม่มีของใส่บาตร')||!(await E('M.classList.contains("on")||!!M.textContent')),'ไม่มีของ → แจ้งว่าไม่มีของใส่บาตร');
 await E('closeM();S.inv={"crop:rice":2,"food:omelet":1,"crop:papaya":1};almsPick(SK.find(q=>q.id==="suk"))');await p.waitForTimeout(500);
 const pm2=await modal();ok(pm2.includes('ข้าว')&&pm2.includes('ไข่เจียว')&&pm2.includes('มะละกอ'),'การ์ดเลือกของแสดงของในกระเป๋าตามหมวด');
 for(let i=0;i<3;i++){await E('[...M.querySelectorAll("button")].filter(b=>b.textContent==="เลือก")[0].click()');await p.waitForTimeout(300)}
 await p.click('text=เริ่มตักบาตร');await p.waitForTimeout(800);
 for(let i=0;i<3;i++){await p.keyboard.down('Space');await p.waitForTimeout(700);await p.keyboard.up('Space');await p.waitForTimeout(1300)}
 await p.waitForTimeout(1000);
 await p.click('text=ถวายเสร็จแล้ว').catch(()=>{});await p.click('text=ถวายเสร็จแล้ว',{timeout:300}).catch(()=>{});await p.waitForTimeout(500);
 ok(await E('S.almsDay===S.day')&&await E('S.money')===500,'ใส่บาตรแล้วไม่หักเงิน');
 ok(await E('(S.inv["crop:rice"]|0)===1&&!S.inv["food:omelet"]&&!S.inv["crop:papaya"]'),'ของที่ถวายถูกหักออกจากกระเป๋าอย่างละ 1');
 // พระปาติโมกข์ครบ 227 ข้อ
 ok(await E('MONK_PAT.reduce((a,x)=>a+x.L.length,0)')===227,'พระปาติโมกข์มีครบ 227 ข้อ');
 await E('closeM();S.patSeen={};patMenu(SK.find(q=>q.id==="suk"))');await p.waitForTimeout(400);
 ok((await modal()).includes('ปาราชิก ๔')&&(await modal()).includes('เสขิยวัตร'),'เมนูพระปาติโมกข์แสดงทุกหมวด');
 await E('closeM();for(let i=0;i<MONK_PAT.length;i++)S.patSeen[i]=1;badgeCheck()');ok(await E('!!S.badge.pat'),'ฟังครบทุกหมวด → ได้เหรียญตรา');
 await done(g,'monk')})();
