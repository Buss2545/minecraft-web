const {boot,ok,done}=require('./lib');
(async()=>{console.log('npc routine variants');const g=await boot(),{E}=g;
 await E("closeM();toScene('w');P.x=8*TS;P.y=40*TS");
 const L=(id,day,h)=>E("(()=>{S.day="+day+";S.min="+h+"*60;S.rain=false;return nextLoc0(NPCS.find(n=>n.id==='"+id+"'))})()");
 /* วัน: 1=จ. ... 6=ส. 7=อา. (dow=(day-1)%7) ฤดูร้อน=วัน 1-28 */
 const FEST=await E("FEST.filter(f=>f.s===0).map(f=>f.d).join(',')");console.log('fest ฤดูร้อน วันที่',FEST);
 console.log('จ 8:00 thee',await L('thee',2,9.5),'| ส thee',await L('thee',6,9.5),'| อา thee',await L('thee',7,9.5));
 ok(await L('thee',2,9.5)==='school','จันทร์ 9:30 ธีไปโรงเรียน');
 ok(await L('thee',6,9.5)==='plazaW','เสาร์ ธีไม่ไปโรงเรียน');
 ok(await L('namfon',7,8.5)==='temple','อาทิตย์ 8:30 น้ำฝนไปวัด');
 ok(await L('baitoey',7,9)==='temple'&&(await L('baitoey',2,9))==='in:clinic','คลินิก: ใบเตยหยุดวันอาทิตย์ ทำงานวันธรรมดา');
 ok(await L('khaohom',2,9)==='farmEdge'&&(await L('khaohom',7,9)==='temple'),'ข้าวหอมวันอาทิตย์ไม่ทำไร่');
 /* ฤดูร้อน เที่ยง */
 ok(await L('khaohom',2,13.2)==='home','ฤดูร้อนเที่ยงงีบที่บ้าน (ข้าวหอม)');
 ok((await L('daeng',2,12.5))!=='home','แม่ค้าร้านชำไม่ถูกส่งไปนอน');
 /* ฤดูหนาว (วัน 57+) ค่ำ */
 ok(await L('namfon',58,19.5)==='home','ฤดูหนาว 19:30 กลับบ้านแล้ว');
 ok((await L('namfon',30,19.5))!=='' ,'ฤดูฝน 19:30 ตามตาราง');
 const act=await E("(()=>{S.day=58;S.min=19.5*60;const n=NPCS.find(n=>n.id==='namfon'),r=S.npcR.namfon;r.loc='home';r.inside='namfon';return npcActivity(n)})()");ok(act.includes('ห่มผ้า'),'ข้อความกิจกรรมฤดูหนาว: '+act);
 const act2=await E("(()=>{S.day=2;S.min=12.5*60;const n=NPCS.find(n=>n.id==='namfon'),r=S.npcR.namfon;r.loc='home';r.inside='namfon';return npcActivity(n)})()");ok(act2.includes('งีบ'),'ข้อความกิจกรรมเที่ยงฤดูร้อน: '+act2);
 await done(g,'npcroutine')})().catch(e=>{console.error(e);process.exit(1)});
