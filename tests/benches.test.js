// ม้านั่งกระจายตามแผนที่ + ไม่ขวางทาง NPC
const {boot,ok,done}=require('./lib');
(async()=>{console.log('benches');const g=await boot();
 const b=await g.E("PROPS.filter(p=>p.t==='bench').map(p=>[p.x,p.y])");
 ok(b.length>=8,'ม้านั่งนอกบ้านกระจาย ≥8 จุด ('+b.length+')');
 ok(!b.some(([x,y])=>x>=23&&x<=39&&y>=8&&y<=12),'ไม่มีม้านั่งที่ลานกลางหมู่บ้านแล้ว');
 const xs=b.map(p=>p[0]),ys=b.map(p=>p[1]);ok(Math.max(...xs)-Math.min(...xs)>=30&&Math.max(...ys)-Math.min(...ys)>=12,'กระจายกว้างทั้งแนวนอน/แนวตั้ง');
 ok(await g.E("PROPS.filter(p=>p.t==='bench').every(p=>solid[p.y][p.x])"),'ม้านั่งชนได้ (solid)');
 ok(await g.E("PROPS.filter(p=>p.t==='bench').every(p=>{for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if((dx||dy)&&solid[p.y+dy][p.x+dx])return false}return true})"),'รอบม้านั่งทุกช่องเดินได้ ไม่เป็นคอขวด');
 ok(await g.E("PROPS.filter(p=>p.t==='bench').every(p=>p.y>=22)"),'ไม่อยู่บนถนน/พื้นที่สงวน');
 /* NPC ยังเดินถึงทุกจุดหลักได้ (ประตูบ้านแต่ละหลัง → ลานกลาง) */
 const bad=await g.E("(()=>{const bad=[];const tx=31,ty=14;for(const b of BLD){if(b.d==null||b.y2>40||b.x1<0||b.id==='cave'||b.id==='kuti'||b.id==='citygate'||b.x1>100)continue;const q=findPath(b.d,b.y2+1,tx,ty);if(!q)bad.push(b.id)}return bad})()");
 ok(bad.length===0,'ประตูทุกหลังเดินถึงถนนกลางได้ '+JSON.stringify(bad));
 /* นั่งได้จริง */
 await g.E("closeM();const p=PROPS.find(q=>q.t==='bench');P.x=p.x*TS+16;P.y=(p.y+1)*TS+4;sitDown(p)");ok(await g.E("!!P.sit"),'นั่งม้านั่งใหม่ได้');
 await g.E("standUp()");ok(await g.E("!P.sit"),'ลุกได้');
 await done(g,'benches')})().catch(e=>{console.error(e);process.exit(1)});
