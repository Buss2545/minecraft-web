// หมวก 15 ชนิด: วาดได้ทั้งตัวเล็ก/ภาพโปรไฟล์ • เลือกแล้วเก็บใน look/lookOf • เพื่อนเห็น (cleanLook ฝั่งเกม+เซิร์ฟเวอร์รับ hw)
const {boot,ok,done}=require('./lib');const fs=require('fs'),path=require('path');
(async()=>{console.log('headwear');const g=await boot();
 ok(await g.E("HW_IDS.length")===15,'มีหมวก 15 ชนิด');
 ok(await g.E("HW_IDS.every(k=>HWD[k].n&&HWD[k].ic&&HWD[k].p.length)"),'ทุกชนิดมีชื่อ/ไอคอน/พิกเซล');
 await g.E("S.look.hw='wizard'");ok(await g.E("lookOf().hw")==='wizard','lookOf ส่ง hw (ใช้ส่งให้เพื่อน)');
 ok(await g.E("cleanLook(lookOf()).hw")==='wizard','cleanLook ฝั่งผู้รับเก็บ hw');
 ok(/"acc",\s*"hw"/.test(fs.readFileSync(path.join(__dirname,'../src/room.js'),'utf8')),'เซิร์ฟเวอร์ room.js ส่งต่อ hw');
 await g.E("S.look.hw='nope'");ok(await g.E("lookOf().hw")==='','ค่าแปลก ๆ ถูกตัดทิ้ง');
 const draws=await g.E("(()=>{let n=0;const c=document.createElement('canvas');c.width=60;c.height=70;const x=c.getContext('2d');for(const k of HW_IDS){const o=Object.assign(lookOf(),{hw:k});for(const d of ['d','u','l','r']){person(x,30,60,o,d,0,2)}facePortrait(o,2);n++}return n})()");
 ok(draws===15,'วาดครบทุกหมวก ทุกทิศ ไม่ error');
 await g.E("S.look.hw='crown';menu('outfit')");await g.p.waitForTimeout(400);
 ok((await g.modal()).includes('หมวก / เครื่องสวมหัว'),'แท็บชุดมีส่วนเลือกหมวก');
 await g.p.click('.itemGrid.o3 >> nth=-1').catch(()=>{});
 await g.E("closeM();S.look.hw=''");
 const sheet=await g.E("(()=>{const c=document.createElement('canvas');c.width=16*70;c.height=130;const x=c.getContext('2d');x.fillStyle='#6fa86f';x.fillRect(0,0,c.width,c.height);HW_IDS.forEach((k,i)=>{const o=Object.assign(lookOf(),{hw:k});x.drawImage(facePortrait(o,2),i*70,0);person(x,i*70+35,125,o,'d',0,2)});return c.toDataURL()})()");
 void sheet;
 await done(g,'headwear')})().catch(e=>{console.error(e);process.exit(1)});
