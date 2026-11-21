// แท็บสถานะ: ไม่มีปุ่ม "ทำเลย" ของฟิตเนสแล้ว • มีส่วน "พระและวัด"
const {boot,ok,done}=require('./lib');
(async()=>{console.log('status-panel');const g=await boot();
 await g.E("menu('status')");await g.p.waitForTimeout(400);
 const m=await g.modal();
 ok(m.includes('ฟิตเนส'),'ยังแสดงเลเวลฟิตเนส');ok(!m.includes('ทำเลย'),'ไม่มีปุ่มทำเลย');ok(m.includes('พระและวัด')&&m.includes('ใส่บาตรวันนี้'),'มีส่วนพระและวัด');
 await done(g,'status-panel')})().catch(e=>{console.error(e);process.exit(1)});
