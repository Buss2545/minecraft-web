const {boot,ok,done}=require('./lib');
(async()=>{console.log('npc routines');const g=await boot(),{E,p}=g;
 await E("closeM();toScene('w');P.x=8*TS;P.y=40*TS;trafficTick=()=>{}");
 const days=Number(process.env.DAYS||4);
 const res=await p.evaluate(async(days)=>{
  const ev=__ev,out={late:{},solid:{},jump:{},night:{},spawn:[]};
  const upd=ev('updateNPCs'),isS=ev('isSolid');const S_=ev('S');
  const cfg=[[0,false],[5,false],[6,false],[33,true],[60,false],[61,false],[62,false],[7,false]];
  for(const [d0,rain] of cfg.slice(0,days)){
   S_.day=d0+1;S_.min=5.5*60;S_.rain=rain;
   const last={},since={},stk={};
   for(let t=0;t<1440*60/60*1;t+=0){ /* วันละ ~ 20 ชม. */
    break}
   let ticks=0;const prev={};
   while(S_.min<24*60-1&&ticks<60000){
    S_.min+=0.5*1.0;ticks++;upd(0.5);
    const hr=S_.min/60;
    for(const id in S_.npcR){const r=S_.npcR[id];if(!r)continue;
     const k=id+'|'+d0;
     if(!r.inside&&(isS(Math.floor(r.x/32),Math.floor((r.y-4)/32)))){out.solid[k]=(out.solid[k]||0)+1}
     const pv=prev[id];if(pv&&!r.inside&&!pv.in&&Math.hypot(pv.x-r.x,pv.y-r.y)>90){out.jump[k]=(out.jump[k]||0)+1}
     prev[id]={x:r.x,y:r.y,in:r.inside};
     const cer=ev('ceremony')();
     const key=r.loc;if(last[id]!==key){last[id]=key;since[id]=S_.min;stk[id]=null}
     if(cer)since[id]=S_.min;
     /* ค้าง: ควรเดินอยู่แต่ตำแหน่งไม่ขยับเลยใน 30 นาที */
     if(ticks%60===0&&!cer){const q=stk[id];if(r.inside||!r.moving){stk[id]=null}else if(!q)stk[id]={x:r.x,y:r.y,n:0};else{if(Math.hypot(q.x-r.x,q.y-r.y)<10){q.n++;if(q.n>=2){out.late[k+'|stuck|'+r.loc+'@'+Math.round(r.x/32)+','+Math.round(r.y/32)]=1;stk[id]=null}}else stk[id]={x:r.x,y:r.y,n:0}}}
     if(S_.min-since[id]>200&&!r.inside&&!r.at&&r.loc&&!(r.loc||'').startsWith('alms')){out.late[k+'|slow|'+r.loc]=(out.late[k+'|slow|'+r.loc]||0)+1}
     if((hr>=23.5||hr<5.5)&&!r.inside&&!['praew','daeng','laddaa'].includes(id)){out.night[k]=(out.night[k]||0)+1}
    }}
  }
  return out},days);
 const show=(n,o)=>{const ks=Object.keys(o);console.log(n,ks.length?JSON.stringify(o).slice(0,1400):'ไม่มี')};
 show('ยืนทับของแข็ง',res.solid);show('วาร์ป/กระโดด',res.jump);show('ถึงช้า/ค้าง',res.late);show('อยู่นอกบ้านดึก',res.night);
 ok(Object.keys(res.solid).length===0,'ไม่มี NPC ยืนทับของแข็ง');
 ok(Object.keys(res.late).length===0,'ไม่มี NPC ค้าง/ไปไม่ถึง');
 ok(Object.keys(res.night).length===0,'ไม่มี NPC เดินดึก');
 await done(g,'npcday')})().catch(e=>{console.error(e);process.exit(1)});
