// เริ่มเกมสายสตรีมเมอร์: โน้ตบุ๊ก RAM 2 GB + เน็ตฟรี • สายชาวไร่ไม่เปลี่ยน • เซฟเก่าย้ายระดับ RAM
const {boot,ok,done}=require('./lib');
(async()=>{const g=await boot({path:'str'}),{E}=g;console.log('streamer-start');
 const r=JSON.parse(await E('JSON.stringify({lap:S.inv.laptop||0,ram:STR_PARTS.ram.L[strGet().ram][0],net:strGet().net===NET_FREE,on:strNetOn()})'));
 ok(r.lap===1,'มีโน้ตบุ๊ก 1 เครื่อง');ok(r.ram==='2 GB','RAM 2 GB');ok(r.net&&r.on,'ใช้เน็ตฟรี ไม่ออฟไลน์');
 const m=JSON.parse(await E(`(()=>{const raw=JSON.parse(JSON.stringify(S));raw.str={ram:1,net:0,nd:0,path:'game',pb:[{k:'ram',lv:2,rem:100,span:100}]};const n=normState(raw),n2=normState(JSON.parse(JSON.stringify(n)));return JSON.stringify({ram:n.str.ram,net:n.str.net===NET_FREE,pb:n.str.pb[0].lv,again:n2.str.ram})})()`));
 ok(m.ram===2&&m.pb===3&&m.again===2,'เซฟเก่า (RAM 8GB) ย้ายเป็นระดับ 2 และไม่ย้ายซ้ำ');ok(m.net,'เซฟเก่าที่ไม่มีเน็ต ย้ายมาใช้เน็ตฟรี');
 await done(g,'streamer-start')})();
