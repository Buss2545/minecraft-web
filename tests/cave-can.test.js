// บัวรดน้ำเติมอัตโนมัติใกล้น้ำเมื่อน้ำใกล้หมด • โชคถ้ำรายวันต่อตัวละคร (วันง่ายมาก/ยากมาก)
const {boot,ok,done}=require('./lib');
(async()=>{console.log('cave-can');const g=await boot();const E=g.E;
 /* --- บัวรดน้ำ --- */
 const wt=await E("(()=>{for(let y=WY0;y<=WY1;y++)for(let x=WX0;x<=WX1;x++){const v=ground[y]&&ground[y][x];if(v===2||v===9||v===5)return [x,y]}return null})()");
 ok(!!wt,'มีช่องน้ำในแผนที่');
 const cap=await E("CAN_CAP[tTier('can')]");
 await E("closeM();OPT.autoTool=1;S.hotbar=TOOLS.findIndex(t=>t.id==='can');S.water=1;P.x=("+wt[0]+"+.5)*TS;P.y=("+wt[1]+"+1.5)*TS;AF_T=0;P.sw=null;P.swFire=0;S.fishing=null;P.sit=0");
 await g.p.waitForTimeout(700);ok(await E("S.water")===cap,'ถือบัว+ใกล้น้ำ+น้ำหมด → เติมเต็มเอง ('+cap+')');
 await E('S.water='+(cap-2)+';AF_T=0');await g.p.waitForTimeout(500);ok(await E("S.water")===cap-2,'น้ำยังเหลือเยอะ → ไม่เติม');
 await E("S.water=1;AF_T=0;S.hotbar=(S.hotbar+1)%6;if(TOOLS[S.hotbar].id==='can')S.hotbar=(S.hotbar+1)%6");await g.p.waitForTimeout(500);ok(await E("S.water")===1,'ไม่ได้ถือบัว → ไม่เติม');
 await E("S.hotbar=TOOLS.findIndex(t=>t.id==='can');P.x=2*TS;P.y=2*TS;AF_T=0;S.water=1");await g.p.waitForTimeout(500);ok(await E("S.water")===1,'อยู่ไกลน้ำ → ไม่เติม');
 /* --- โชคถ้ำ --- */
 const tiers=await E("(()=>{const o={};for(let d=1;d<=600;d++){S.day=d;const k=mineLuckDay()[0];o[k]=(o[k]|0)+1}return o})()");
 ok(tiers.vh>0&&tiers.ve>0&&tiers.vh<tiers.n&&tiers.n>tiers.h,'มีครบวันง่ายมาก/ยากมาก และวันปกติเยอะสุด '+JSON.stringify(tiers));
 const a=await E("(S.day=5,mineLuckDay()[0])"),a2=await E("(S.day=5,mineLuckDay()[0])");ok(a===a2,'วันเดิม ผลเดิม');
 const nm=await E("(()=>{const n0=S.name;S.name='A';let x=0;for(let d=1;d<=200;d++){S.day=d;x+=mineLuckDay()[0]}S.name='B';let y=0;for(let d=1;d<=200;d++){S.day=d;y+=mineLuckDay()[0]}S.name=n0;return x!==y})()");ok(nm,'ต่างตัวละคร → ลำดับวันโชคต่างกัน');
 const find=async k=>E("(()=>{for(let d=1;d<=2000;d++){S.day=d;if(mineLuckDay()[0]==='"+k+"')return d}return 0})()");
 const dvh=await find('vh'),dve=await find('ve');
 const ores=async d=>E("(()=>{S.day="+d+";let n=0;for(let f=1;f<=40;f++){enterMine(f);n+=MINE.rocks.filter(q=>q.ore).length}leaveMine();return n})()");
 const ov=await ores(dvh),oe=await ores(dve);ok(oe>ov*2,'วันหาง่ายมากเจอแร่มากกว่าวันหายากมาก ('+oe+' vs '+ov+')');
 /* --- แอดมินปรับได้ + มอนสเตอร์ใหม่ --- */
 await E("bal().mlkMode=5");ok(await E("mineLuckDay()[0]")==='ve','แอดมินบังคับโชคถ้ำ = หาง่ายมาก');await E("bal().mlkMode=0;bal().mlkVh=0");
 ok(await E("(()=>{for(let d=1;d<=600;d++){S.day=d;if(mineLuckDay()[0]==='vh')return false}return true})()"),'แอดมินตั้งโอกาสวันหายากมาก = 0 → ไม่มีวันนั้น');await E("bal().mlkVh=7");
 await E("bal().monNew=100;bal().monRate=300");
 for(const [fl,t] of [[10,'spider'],[25,'scorpion'],[45,'crab'],[75,'lavaworm']]){
  const seen=await E("(()=>{const o={};for(let f="+fl+";f<"+(fl+6)+";f++){enterMine(f);MINE.mons.forEach(m=>o[m.t]=1)}return Object.keys(o)})()");
  ok(seen.includes(t),'ชั้น '+fl+'+ มี '+t+' ('+seen.join(',')+')');await g.p.waitForTimeout(400)}
 ok(await E("MINE.mons.every(m=>MON_STAT[m.t]&&m.hp>0)"),'มอนสเตอร์ทุกตัวมีค่าสถานะ');
 await E("bal().monRate=0;enterMine(20)");ok(await E("MINE.mons.length")===0,'แอดมินตั้งจำนวนมอน 0% → ไม่มีมอน');
 await E("bal().monRate=100;bal().monNew=0;enterMine(80)");ok(await E("MINE.mons.every(m=>['slime','bat','khamod'].includes(m.t))"),'โอกาสมอนใหม่ 0% → เหลือมอนเดิม');
 await E("leaveMine()");
 await done(g,'cave-can')})().catch(e=>{console.error(e);process.exit(1)});
