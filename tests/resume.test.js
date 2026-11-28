/* รีเฟรช/โหลดเซฟ: ต้องกลับมายืนจุดเดิม (ทั้งกลางแจ้งและในอาคาร/เมือง) */
const {boot,ok,done}=require('./lib.js');
(async()=>{const g=await boot();
 await g.E("closeM();S.day=SL*2+8;S.htSeen=1;S.min=10*60");
 /* กลางแจ้งบนถนนเหนือ (y ติดลบ) */
 await g.E("toScene('w');P.x=72*TS;P.y=-11*TS;save()");
 await g.E("toScene('w');P.x=1;P.y=1;loadSave()");
 ok(await g.E("scene==='w'&&Math.abs(P.x-72*TS)<2&&Math.abs(P.y+11*TS)<2"),'กลางแจ้ง (ถนนเหนือ) ยืนจุดเดิม');
 /* จุดเดิมตัน → หาช่องว่างใกล้ๆ ไม่เด้งไปจุดเริ่มต้น */
 await g.E("toScene('w');P.x=72*TS;P.y=-11*TS;S.px=-19.5*TS;S.py=-15.5*TS;S.at=null;");
 /* ในสารใจ */
 for(const [id,x,y] of [['hometown',40,20],['city',30,8],['police',5,4],['hth_ht1',3.5,5]]){
  await g.E("closeM();toScene('i','"+id+"');P.x="+x+"*TS;P.y="+y+"*TS;save()");
  await g.E("toScene('w');P.x=5*TS;P.y=5*TS;loadSave()");
  ok(await g.E("scene==='i'&&curInt.id==='"+id+"'&&Math.abs(P.x-"+x+"*TS)<2&&Math.abs(P.y-"+y+"*TS)<2"),'อยู่ที่เดิมใน '+id);}
 await g.E("toScene('w');P.x=16.5*TS;P.y=20.6*TS;save();toScene('w');loadSave()");
 ok(await g.E("scene==='w'&&Math.abs(P.x-16.5*TS)<2"),'โหลดจากกลางแจ้งยังปกติ');
 await done(g,'resume')})();
