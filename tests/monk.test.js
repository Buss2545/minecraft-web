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
 // มินิเกมใส่บาตร: กดค้างตักได้ครบ 3 อย่าง แล้วกด "ถวายเสร็จแล้ว" ซ้ำ จ่ายเงินครั้งเดียว
 await E('closeM();S.min=6*60;S.almsDay=-1;S.money=500;almsGame(SK.find(q=>q.id==="suk"))');await p.waitForTimeout(800);
 for(let i=0;i<3;i++){await p.keyboard.down('Space');await p.waitForTimeout(700);await p.keyboard.up('Space');await p.waitForTimeout(1300)}
 await p.waitForTimeout(1000);
 await p.click('text=ถวายเสร็จแล้ว').catch(()=>{});await p.click('text=ถวายเสร็จแล้ว',{timeout:300}).catch(()=>{});await p.waitForTimeout(500);
 ok(await E('S.almsDay===S.day')&&await E('S.money')===470,'ใส่บาตรแล้วหักเงิน ฿30 ครั้งเดียว');
 await done(g,'monk')})();
