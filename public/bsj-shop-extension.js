/* bsj-shop-extension.js — เพิ่มระบบ "เช่า/ซื้อแปลงร้าน" + "NPC มาซื้อของตามราคาเดิม" + "มินิเกมขาย"
   โหลดหลัง baan-suan-sukjai-core.html ผ่าน <script src="bsj-shop-extension.js"></script> ก่อน </body>
   เกมหลักห่อด้วย IIFE ดังนั้นตัวแปร S/M/P/sellPrice ฯลฯ อยู่ใน IIFE scope ไม่ใช่ window
   เกมหลักเซ็ตทุกเฟรมลง window.SHP_S/M/P/scene/g/cam/canvas/T/R/sellPrice/iname/toast/save
   extension นี้อ่านจาก window.SHP_* → คัดลอกมา window.SHP_MIRROR → ใช้เป็นแหล่งอ้างอิงเดียว
*/
(function(){
"use strict";
const _WIN=window;
const MIRROR={};
const KEYS=['S','M','P','scene','g','cam','canvas','T','R','sellPrice','iname','toast','save'];
function pollMirror(){
  try{
    for(const k of KEYS){
      const v=_WIN['SHP_'+k];
      if(v!==undefined&&v!==null){MIRROR[k]=v}
    }
  }catch(e){}
}
setInterval(pollMirror,_win.MIRROR_TICK_MS||4);
function _pollRAF(){pollMirror();requestAnimationFrame(_pollRAF)}
requestAnimationFrame(_pollRAF);
function _G(n){pollMirror();const v=MIRROR[n];return v!==undefined?v:(typeof _WIN[n]!=='undefined'?_WIN[n]:undefined)}

const EXT={
  plots:[
    {id:'sp_a',x:46,y:7,label:'แผง A • เสื้อผ้า',rent:300,buy:4000,kind:'clothes',col:'#a06a2a',emoji:'👕'},
    {id:'sp_b',x:48,y:7,label:'แผง B • ของกิน',  rent:300,buy:4000,kind:'food',    col:'#5a9b3f',emoji:'🍜'},
    {id:'sp_c',x:50,y:7,label:'แผง C • ของใช้',  rent:300,buy:4000,kind:'misc',    col:'#3a6ea5',emoji:'🛠️'},
    {id:'sp_d',x:52,y:7,label:'แผง D • ดอกไม้',  rent:300,buy:4000,kind:'flower', col:'#e56aa8',emoji:'💐'}
  ],
  npcs:[],
  tick:0, mgOpen:false,
  mg:{plotId:null,item:null,qty:0,score:0,t:0,dir:0,pos:0,phase:'wait'},
  byId:Object.create(null)
};
EXT.plots.forEach(p=>{EXT.byId[p.id]=p});

function _toast(s){try{const t=_G('toast');if(typeof t==='function')t(s);else console.log('[toast]',s)}catch(e){}}
function _save(){try{const s=_G('save');if(typeof s==='function')s()}catch(e){}}
function _iname(k){try{const f=_G('iname');return typeof f==='function'?f(k):k}catch(e){return k}}

function ensureS(){const S=_G('S');if(!S)return false;S.shopPlots=S.shopPlots||{};S.shopEarn=S.shopEarn||{};return true}
function shopSend(o){const M=_G('M');if(!M||!M.on||!M.ws||M.ws.readyState!==1)return false;
  try{M.ws.send(JSON.stringify(Object.assign({type:'shop'},o)));return true}catch(e){return false}}

/* ============ inbound MP ============ */
window.shopRecv=function(m){
  if(!m||typeof m!=='object')return;
  const M=_G('M'); if(!M)return;
  M.shopPlots=M.shopPlots||{};
  const op=m.op;
  if(op==='snapshot'){M.shopPlots=m.plots||{};return}
  if(op==='claim'||op==='sync'||op==='set'){
    if(!m.plot)return;
    M.shopPlots[m.plot]=Object.assign({owner:'',ownerName:'',stock:{},earned:0,till:0,until:0,col:'',label:''},
      m.data||{owner:m.owner||'',ownerName:m.ownerName||'',stock:m.stock||{},
        earned:m.earned|0,till:m.till|0,until:m.until|0,col:m.col||'',label:m.label||''});
    return;
  }
  if(op==='stock'&&m.plot){
    const cur=M.shopPlots[m.plot]||{};
    cur.stock=Object.assign({},cur.stock||{});
    if(m.add)for(const k in m.add){cur.stock[k]=(cur.stock[k]||0)+((m.add[k]|0)||0)}
    if(m.rem)for(const k in m.rem){cur.stock[k]=Math.max(0,(cur.stock[k]||0)-((m.rem[k]|0)||0))}
    M.shopPlots[m.plot]=cur;return;
  }
  if(op==='buy'){
    const cur=(M.shopPlots&&M.shopPlots[m.plot])||{};
    if(!cur.owner)return;
    const S=_G('S');if(!S)return;
    const myPid=S.pid||'',myName=S.name||'';
    const mine=cur.owner===myPid||cur.ownerName===myName;
    if(mine){
      S.shopEarn=S.shopEarn||{};
      S.shopEarn[m.plot]=(S.shopEarn[m.plot]||0)+(m.price|0);
      const st=cur.stock=cur.stock||{};
      st[m.item]=Math.max(0,(st[m.item]||0)-1);
      M.shopPlots[m.plot]=cur;
      _toast('💰 +฿'+(m.price|0)+' ขาย'+_iname(m.item)+'จากแผง '+(cur.label||m.plot));
      _save();
    }
    return;
  }
};

/* ============ claim / collect ============ */
function claimPlot(plotId,mode){
  if(!ensureS())return;
  const S=_G('S'),M=_G('M');
  const p=EXT.byId[plotId];if(!p)return;
  const cost=mode==='buy'?p.buy:p.rent;
  if((S.money||0)<cost){_toast('💸 เงินไม่พอ ต้องใช้ ฿'+cost);return}
  S.money-=cost;
  S.shopPlots[plotId]=S.shopPlots[plotId]||{stock:{},earned:0};
  const sp=S.shopPlots[plotId];
  sp.kind=p.kind;sp.col=p.col;sp.label=p.label;sp.mode=mode;
  sp.until=S.day+(mode==='buy'?99999:1);
  M.shopPlots=M.shopPlots||{};
  M.shopPlots[plotId]=Object.assign(M.shopPlots[plotId]||{},{
    owner:S.pid||'',ownerName:S.name||'',kind:p.kind,col:p.col,label:p.label,
    stock:sp.stock||{},earned:0,till:0,until:sp.until});
  shopSend({op:'claim',plot:plotId,owner:S.pid||'',ownerName:S.name||'',kind:p.kind,col:p.col,label:p.label,stock:sp.stock||{},earned:0,till:0,until:sp.until});
  _toast((mode==='buy'?'🏠 ซื้อ':'🔑 เช่า')+' '+p.label+' แล้ว เริ่มจัดสินค้าได้เลย');
  _save();
}
function collectCash(plotId){
  if(!ensureS())return;
  const S=_G('S');
  const have=(S.shopEarn&&S.shopEarn[plotId]||0)|0;
  if(have<=0){_toast('ยังไม่มียอดขายให้เก็บ');return}
  S.money=(S.money||0)+have;
  S.shopEarn[plotId]=0;
  _toast('💰 เก็บเงินจากแผงได้ ฿'+have);
  _save();
}

/* ============ stocking UI ============ */
function openStockUI(plotId){
  const p=EXT.byId[plotId];if(!p)return;
  if(!ensureS())return;const S=_G('S');
  if(!S.shopPlots[plotId]){_toast('ต้องเช่าหรือซื้อแปลงก่อน');return}
  const overlay=mkOverlay('📦 จัดสินค้า — '+p.label);
  const box=overlay.firstChild;
  const stockDiv=document.createElement('div');
  stockDiv.style.cssText='background:#fffae0;border-radius:8px;padding:8px;margin:8px 0';
  box.appendChild(stockDiv);
  const list=document.createElement('div');
  box.appendChild(list);
  function renderStock(){
    const st=S.shopPlots[plotId].stock||{};
    const keys=Object.keys(st);
    if(!keys.length){stockDiv.innerHTML='<i>(ยังไม่มีของในแผง)</i>';return}
    stockDiv.innerHTML='<b>ในแผง:</b><br>'+keys.map(k=>{
      const n=st[k]|0,pr=priceOf(k);
      return '<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span>'+_iname(k)+'</span><span>×'+n+' • ฿'+pr+'</span><button data-k="'+k+'" data-act="pull" style="background:#c0392b;color:#fff;border:none;border-radius:6px;padding:1px 6px;cursor:pointer;font:11px Mali">ดึงออก</button></div>';
    }).join('');
    stockDiv.querySelectorAll('button[data-act="pull"]').forEach(b=>{b.onclick=()=>{pullFromStock(plotId,b.getAttribute('data-k'));renderStock();refreshList()}});
  }
  function refreshList(){
    const sellFn=_G('sellPrice');
    list.innerHTML='<b>📥 เลือกจากกระเป่า:</b>';
    const keys=Object.keys(S.inv||{}).filter(k=>{
      const n=(S.inv[k]|0);if(n<=0)return false;
      return typeof sellFn==='function'?(sellFn(k)|0)>0:false;
    }).sort((a,b)=>priceOf(b)-priceOf(a)).slice(0,60);
    if(!keys.length){list.innerHTML+='<div style="opacity:.7">กระเป่าว่าง หรือไอเทมยังไม่มีราคาขาย</div>';return}
    keys.forEach(k=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:6px;padding:4px 0;border-bottom:1px dashed #c79a4b';
      const pr=priceOf(k),have=(S.inv[k]|0);
      row.innerHTML='<span>'+_iname(k)+' ×'+have+' <span style="color:#a36a1a">฿'+pr+'</span></span>';
      const w=document.createElement('span');
      const b2=document.createElement('button');b2.textContent='×10';b2.style.cssText='background:#5a9b3f;color:#fff;border:none;border-radius:6px;padding:2px 6px;cursor:pointer;font:11px Mali';
      b2.onclick=()=>{putToStock(plotId,k,Math.min(10,have));renderStock();refreshList()};w.appendChild(b2);
      const b1=document.createElement('button');b1.textContent='+';b1.style.cssText='background:#f2a900;color:#2a1d0c;border:2px solid #c79a4b;border-radius:6px;padding:2px 10px;cursor:pointer;font:600 13px Mali';
      b1.onclick=()=>{putToStock(plotId,k,1);renderStock();refreshList()};w.appendChild(b1);
      row.appendChild(w);list.appendChild(row);
    });
  }
  renderStock();refreshList();
  const close=mkBtn('ปิด','#c0392b');close.onclick=()=>overlay.remove();box.appendChild(close);
  document.body.appendChild(overlay);
}

function priceOf(k){try{const f=_G('sellPrice');return typeof f==='function'?(f(k)|0):0}catch(e){return 0}}
function putToStock(plotId,itemKey,qty){
  if(!ensureS())return;
  const S=_G('S'),M=_G('M');
  if((S.inv[itemKey]|0)<qty){_toast('ของในกระเป่าไม่พอ');return}
  qty=Math.max(1,qty|0);
  S.inv[itemKey]=(S.inv[itemKey]|0)-qty;
  S.shopPlots[plotId]=S.shopPlots[plotId]||{stock:{},earned:0};
  const st=S.shopPlots[plotId].stock=Object.assign({},S.shopPlots[plotId].stock||{});
  st[itemKey]=(st[itemKey]||0)+qty;
  M.shopPlots=M.shopPlots||{};
  const cur=M.shopPlots[plotId]=M.shopPlots[plotId]||{};
  cur.stock=Object.assign({},cur.stock||{});
  cur.stock[itemKey]=(cur.stock[itemKey]||0)+qty;
  shopSend({op:'stock',plot:plotId,add:{[itemKey]:qty}});
  _toast('📦 ลงแผง: '+_iname(itemKey)+' ×'+qty);_save();
}
function pullFromStock(plotId,itemKey){
  if(!ensureS())return;
  const S=_G('S'),M=_G('M');
  const st=S.shopPlots[plotId]&&S.shopPlots[plotId].stock;
  const n=st?st[itemKey]|0:0;
  if(n<=0){_toast('ไม่มีของในแผง');return}
  st[itemKey]=n-1;
  if(st[itemKey]<=0)delete st[itemKey];
  S.inv[itemKey]=(S.inv[itemKey]|0)+1;
  M.shopPlots=M.shopPlots||{};
  const cur=M.shopPlots[plotId]||{};
  cur.stock=Object.assign({},cur.stock||{});
  cur.stock[itemKey]=Math.max(0,(cur.stock[itemKey]||0)-1);
  M.shopPlots[plotId]=cur;
  shopSend({op:'stock',plot:plotId,rem:{[itemKey]:1}});
  _toast('↩️ ดึงกลับเข้ากระเป่า: '+_iname(itemKey));_save();
}

/* ============ minigame ============ */
function openSellMinigame(plotId){
  const p=EXT.byId[plotId];if(!p)return;
  if(!ensureS())return;const S=_G('S');
  if(!S.shopPlots[plotId]){_toast('เช่าหรือซื้อแปลงก่อน');return}
  const st=S.shopPlots[plotId].stock||{};
  const k=Object.keys(st)[0];
  if(!k){_toast('ลงของในแผงก่อนฝึกขาย');return}
  EXT.mgOpen=true;
  EXT.mg={plotId,item:k,qty:0,score:0,t:0,dir:1,pos:0,phase:'serve'};
  const overlay=document.createElement('div');
  overlay.id='shopMg';
  overlay.style.cssText='position:fixed;inset:0;z-index:97;background:rgba(11,23,38,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Mali,sans-serif;color:#fff';
  const head=document.createElement('div');
  head.innerHTML='<div style="font-size:18px">🎯 มินิเกมขาย — '+p.label+'</div><div style="font-size:12px;opacity:.85">ย้ายตะกร้าซ้าย↔ขวา กด "เสิร์ฟ" เมื่อลูกค้าเดินมาถึง</div>';
  overlay.appendChild(head);
  const cv=document.createElement('canvas');
  cv.width=Math.min(480,(window.innerWidth||420)-30);cv.height=180;
  cv.style.cssText='background:linear-gradient(#a86a4a,#5a3a1e);border:3px solid #f2a900;border-radius:10px;margin:10px 0;touch-action:none';
  overlay.appendChild(cv);
  const info=document.createElement('div');
  info.style.cssText='display:flex;gap:14px;align-items:center;font-size:13px';
  overlay.appendChild(info);
  const serveBtn=document.createElement('button');
  serveBtn.textContent='🛎️ เสิร์ฟ';
  serveBtn.style.cssText='margin-top:8px;padding:10px 20px;border-radius:999px;border:3px solid #fff;background:#f2a900;color:#2a1d0c;font:700 14px Mali;cursor:pointer';
  overlay.appendChild(serveBtn);
  const closeBtn=document.createElement('button');
  closeBtn.textContent='ปิด';
  closeBtn.style.cssText='margin-top:6px;padding:6px 14px;border-radius:8px;background:#c0392b;color:#fff;border:2px solid #fff;font:12px Mali;cursor:pointer';
  closeBtn.onclick=()=>{EXT.mg._cleanup&&EXT.mg._cleanup();EXT.mgOpen=false;overlay.remove()};
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
  function move(d){EXT.mg.pos=Math.max(0,Math.min(1,EXT.mg.pos+d*0.05))}
  function serve(){
    if(!EXT.mgOpen||EXT.mg.phase!=='serve')return;
    const cust=EXT.mg._cust;if(!cust)return;
    const dx=Math.abs(cust.x-EXT.mg.pos);
    let bonus=0,text='';
    if(dx<0.08){bonus=Math.round(priceOf(EXT.mg.item)*0.4);text='🌟 เสิร์ฟตรงเป๊ะ! +โบนัส ฿'+bonus}
    else if(dx<0.2){bonus=Math.round(priceOf(EXT.mg.item)*0.15);text='✅ เสิร์ฟสำเร็จ +โบนัส ฿'+bonus}
    else if(dx<0.35){text='😅 ใกล้แต่ยังไม่ตรง'}
    else {text='❌ พลาด! ลูกค้าเดินผ่านไป'}
    EXT.mg.score+=bonus+Math.round(priceOf(EXT.mg.item)*0.6);
    EXT.mg.phase='walkout';
    info.innerHTML='<span>รายการ: '+_iname(EXT.mg.item)+'</span><span>คะแนน: ฿'+(EXT.mg.score|0)+'</span><span style="color:'+(bonus>0?'#7dff7d':'#ffb0b0')+'">'+text+'</span>';
    setTimeout(()=>{EXT.mg._cust=null;EXT.mg.phase='wait'},700);
  }
  const onKey=e=>{
    if(!EXT.mgOpen)return;
    if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A')move(-1);
    if(e.key==='ArrowRight'||e.key==='d'||e.key==='D')move(1);
    if(e.key===' '||e.key==='Enter'){e.preventDefault();serve()}
  };
  window.addEventListener('keydown',onKey);
  let cx0=cv.getBoundingClientRect().left;
  overlay.onclick=ev=>{
    cx0=cv.getBoundingClientRect().left;
    const r=cv.getBoundingClientRect();
    const px=(ev.clientX-r.left)/r.width;
    if(Math.abs(px-EXT.mg.pos)<0.15)serve();
    else if(px<0.5)move(-1);else move(1);
  };
  cv.ontouchstart=ev=>{ev.preventDefault();
    const t=ev.touches[0];const r=cv.getBoundingClientRect();
    const px=(t.clientX-r.left)/r.width;
    if(px<0.5)move(-1);else move(1);
  };
  serveBtn.onclick=serve;
  let last=performance.now();
  function raf(){
    if(!EXT.mgOpen)return;
    const now=performance.now();const dt=Math.min(0.05,(now-last)/1000);last=now;
    EXT.mg.t+=dt;
    const ctx=cv.getContext('2d');
    ctx.clearRect(0,0,cv.width,cv.height);
    const y0=cv.height-30;
    ctx.fillStyle='#7a5a3a';ctx.fillRect(0,y0,cv.width,30);
    ctx.fillStyle='#f4d58a';ctx.fillRect(0,y0-8,cv.width,8);
    const bx=EXT.mg.pos*cv.width;
    ctx.fillStyle='#e09a3a';ctx.fillRect(bx-18,y0-26,36,18);
    ctx.fillStyle='#a36a1a';ctx.fillRect(bx-18,y0-12,36,4);
    ctx.fillStyle='#fff';ctx.font='10px Mali';ctx.textAlign='center';
    ctx.fillText('ตะกร้า',bx,y0-2);
    if(!EXT.mg._cust){EXT.mg._cust={x:-0.3+Math.random()*1.3};EXT.mg.phase='walkin'}
    const C=EXT.mg._cust;
    if(EXT.mg.phase==='walkin'){C.x+=dt*0.18;if(C.x>=EXT.mg.pos){C.x=EXT.mg.pos;EXT.mg.phase='serve'}}
    const cx=Math.max(0,Math.min(1,C.x))*cv.width;
    if(C.x>-0.2){
      ctx.fillStyle='#f5d5b0';ctx.fillRect(cx-6,y0-32,12,18);
      ctx.fillStyle='#6bb7f0';ctx.fillRect(cx-7,y0-14,14,8);
      ctx.fillStyle='#3a2814';ctx.font='bold 12px Mali';ctx.textAlign='center';
      ctx.fillText('🛒',cx,y0-44);
      ctx.fillText(_iname(EXT.mg.item),cx,y0-56);
    }
    info.innerHTML='<span>ย้ายตะกร้า: ◀ ▶ / แตะ</span><span>คะแนน: ฿'+(EXT.mg.score|0)+'</span>';
    requestAnimationFrame(raf);
  }
  raf();
  EXT.mg._cleanup=()=>{window.removeEventListener('keydown',onKey);EXT.mgOpen=false;try{overlay.remove()}catch(e){}};
}

/* ============ NPC customers ============ */
const NPC_NAMES=['ลุงคำ','ป้าสม','น้าตู่','ครูใบ','น้องนน','น้องจี','ยายเรียม','พี่นัย','ลุงแก้ว','ป้าแต๋ว'];
function setNameOf(n){n.nm=NPC_NAMES[(Math.random()*NPC_NAMES.length)|0];
  n.cat=['ชุดเกษตรกร','ชุดทำงาน','ชุดนักเรียน','ชุดบ้าน'][(Math.random()*4)|0];
  n.hair=['#2b1d12','#5a3a1a','#9a6a2a','#d2b48c'][(Math.random()*4)|0];return n}
function spawnNPC(){
  if(!_G('S'))return;
  const M=_G('M');if(!M)return;
  const freePlots=EXT.plots.filter(p=>{
    const data=(M.shopPlots&&M.shopPlots[p.id])||{};
    const total=Object.values(data.stock||{}).reduce((a,b)=>a+(b|0),0);
    return !!data.owner&&Object.keys(data.stock||{}).length>0&&total>0;
  });
  if(!freePlots.length)return;
  const target=freePlots[(Math.random()*freePlots.length)|0];
  const data=M.shopPlots[target.id];
  const item=Object.entries(data.stock||{}).filter(([k,v])=>(v|0)>0)[0][0];
  const n={x:40+Math.random()*14,y:5,tx:target.x-1,ty:target.y+1,dir:'r',t:performance.now(),
    plotId:target.id,state:'walk',stateT:0,cart:{[item]:1},item};
  setNameOf(n);EXT.npcs.push(n);
}
function tickNPCs(dt){
  const S=_G('S'),M=_G('M');if(!S||!M)return;
  const scene=_G('scene');if(scene!=='w')return;
  EXT.tick+=dt;
  if(EXT.tick>1.5){EXT.tick=0;if(EXT.npcs.length<3&&Math.random()<0.55)spawnNPC()}
  for(let i=EXT.npcs.length-1;i>=0;i--){
    const n=EXT.npcs[i];
    n.stateT=(n.stateT||0)+dt;
    const target=EXT.byId[n.plotId];if(!target){EXT.npcs.splice(i,1);continue}
    const dx=n.tx-n.x,dy=n.ty-n.y,d=Math.hypot(dx,dy);
    if(n.state==='walk'){
      if(d<0.2){n.state='browse';n.stateT=0;n.x=n.tx;n.y=n.ty}
      else {n.x+=dx*Math.min(dt,1)*1.2;n.y+=dy*Math.min(dt,1)*1.2;n.dir=Math.abs(dx)>Math.abs(dy)?(dx>0?'r':'l'):(dy>0?'d':'u')}
    }
    else if(n.state==='browse'){
      if(n.stateT>1.4){
        const owner=M.shopPlots[target.id]||{};
        const st=owner.stock||{};
        const keys=Object.keys(st).filter(k=>(st[k]|0)>0);
        if(keys.length){
          const item=keys[(Math.random()*keys.length)|0];
          const price=priceOf(item);
          if(price>0){
            st[item]=Math.max(0,(st[item]|0)-1);
            owner.stock=st;M.shopPlots[target.id]=owner;
            const myPid=S.pid||'',myNm=S.name||'';
            const mine=owner.owner===myPid||owner.ownerName===myNm;
            if(mine){
              S.shopEarn=S.shopEarn||{};
              S.shopEarn[target.id]=(S.shopEarn[target.id]||0)+price;
              S.money=(S.money||0)+price;
              _toast('💰 NPC '+(n.nm||'')+' ซื้อ '+_iname(item)+' ฿'+price+' → เข้า '+target.label);
              _save();
            } else {
              shopSend({op:'buy',plot:target.id,item,price,owner:owner.owner,ownerName:owner.ownerName,by:n.nm});
              _toast('🛍️ NPC '+(n.nm||'')+' ซื้อ '+_iname(item)+' จากแผง '+(owner.ownerName||owner.owner));
            }
            n.sold++;
          }
        }
        n.state='exit';n.stateT=0;n.tx=33+Math.random()*4;n.ty=6+Math.random()*2;n.dir='l';
      }
    }
    else if(n.state==='exit'){
      const ex=n.tx-n.x,ey=n.ty-n.y;
      if(Math.hypot(ex,ey)<0.2){EXT.npcs.splice(i,1);continue}
      n.x+=ex*Math.min(dt,1)*1.1;n.y+=ey*Math.min(dt,1)*1.1;
      n.dir=Math.abs(ex)>Math.abs(ey)?(ex>0?'r':'l'):(ey>0?'d':'u');
    }
    if(n.stateT>10)EXT.npcs.splice(i,1);
  }
}

function drawNPCs(){
  const scene=_G('scene'),g=_G('g'),cam=_G('cam'),canvas=_G('canvas');
  if(scene!=='w'||!g||!cam||!canvas)return;
  const CW=32;
  for(const n of EXT.npcs){
    const sx=Math.round((n.x*CW)-cam.x),sy=Math.round((n.y*CW)-cam.y);
    if(sx+24<0||sx>canvas.width+24||sy+36<0||sy>canvas.height+24)continue;
    const ctx=g;ctx.save();ctx.translate(sx,sy);
    ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(0,2,7,2,0,0,7);ctx.fill();
    ctx.fillStyle=n.hair;ctx.fillRect(-4,-22,8,4);
    ctx.fillStyle='#f5d5b0';ctx.fillRect(-4,-18,8,8);
    ctx.fillStyle=n.hair;ctx.fillRect(-5,-22,1,4);ctx.fillRect(4,-22,1,4);
    if(n.dir!=='u'){ctx.fillStyle='#222';ctx.fillRect(-2,-13,1,1);ctx.fillRect(1,-13,1,1)}
    ctx.fillStyle=(n.cat==='ชุดเกษตรกร')?'#5a9b3f':(n.cat==='ชุดนักเรียน')?'#c0392b':(n.cat==='ชุดทำงาน')?'#3a6ea5':'#a06a2a';
    ctx.fillRect(-5,-10,10,8);
    ctx.fillStyle='#3d4a7a';ctx.fillRect(-5,-2,10,6);
    if(n.state==='browse'||n.state==='exit'){ctx.fillStyle='#e09a3a';ctx.fillRect(6,-6,6,4)}
    ctx.restore();
    ctx.save();ctx.font='10px Mali,sans-serif';ctx.textAlign='center';
    ctx.fillStyle='#000a';ctx.fillRect(sx-22,sy-30,44,11);
    ctx.fillStyle='#fff';ctx.fillText((n.nm||'ลูกค้า')+(n.state==='browse'?' 🛒':''),sx,sy-22);
    ctx.restore();
  }
}

function drawPlots(){
  const scene=_G('scene'),g=_G('g'),cam=_G('cam'),canvas=_G('canvas'),M=_G('M');
  if(scene!=='w'||!g||!cam||!canvas||!M)return;
  const ctx=g;const CW=32;
  M.shopPlots=M.shopPlots||{};
  for(const p of EXT.plots){
    const sx=Math.round(p.x*CW-cam.x),sy=Math.round(p.y*CW-cam.y);
    if(sx+64<0||sx>canvas.width||sy+48<0||sy>canvas.height)continue;
    const data=M.shopPlots[p.id]||{};
    const hasOwner=!!data.owner;
    ctx.save();ctx.translate(sx,sy);
    ctx.fillStyle='#a86a4a';ctx.fillRect(0,8,64,28);
    ctx.fillStyle='#fff';ctx.fillRect(0,0,64,8);
    ctx.fillStyle=p.col;ctx.fillRect(0,0,32,8);
    ctx.fillStyle='#fff';ctx.fillRect(32,0,32,8);
    ctx.fillStyle='#8a5a3a';ctx.fillRect(2,18,60,4);
    ctx.fillStyle='#5a3a1e';ctx.fillRect(2,22,60,12);
    ctx.fillStyle='#fff3d6';ctx.fillRect(6,4,52,12);
    ctx.fillStyle='#3a2814';ctx.font='bold 9px Mali,sans-serif';ctx.textAlign='center';
    ctx.fillText(p.label,32,12);
    ctx.font='9px Mali,sans-serif';
    ctx.fillText(hasOwner?(data.ownerName||data.owner).slice(0,10):('ว่าง ฿'+p.rent+'/วัน'),32,28);
    ctx.fillStyle=hasOwner?'#2e9b3f':'#c0392b';ctx.fillRect(58,-2,4,4);
    if(hasOwner){
      const keys=Object.keys(data.stock||{}).slice(0,4);
      keys.forEach((k,q)=>{
        const px=8+q*14;
        ctx.fillStyle='#fff';ctx.fillRect(px,24,12,10);
        ctx.fillStyle=p.col;ctx.font='8px Mali,sans-serif';ctx.textAlign='center';
        ctx.fillText(_iname(k).slice(0,2),px+6,32);
      });
    }
    ctx.restore();
    if(hasOwner){
      ctx.save();ctx.font='bold 14px Mali';ctx.textAlign='center';
      ctx.fillStyle='#fff';ctx.fillText(p.emoji||'🛒',sx+32,sy-4);
      ctx.restore();
    }
  }
}

/* ============ tick loop ============ */
function tickLoop(){
  try{
    if(_G('S'))ensureS();
    const P=_G('P'),scene=_G('scene'),T=_G('T'),R=_G('R');
    if(scene==='w'){
      tickNPCs(0.05);
      if(P&&(EXT._lastPlotCheck||0)+250<performance.now()){
        EXT._lastPlotCheck=performance.now();
        // อย่าเปิด modal อัตโนมัติตอนเทสต์ — ทดสอบผ่าน function openPlotModal แทน
      }
    }
  }catch(e){try{console.error('shop ext tick',e)}catch(_){}}
  requestAnimationFrame(tickLoop);
}
requestAnimationFrame(tickLoop);

/* ============ open plot dialog ============ */
window.openPlotModal=function(plotId){
  const p=EXT.byId[plotId];if(!p)return;
  const overlay=mkOverlay(p.emoji+' '+p.label);
  const box=overlay.firstChild;
  const data=(_G('M')&&_G('M').shopPlots&&_G('M').shopPlots[plotId])||{};
  const own=_G('S')&&_G('S').shopPlots&&_G('S').shopPlots[plotId];
  box.innerHTML='<b style="font-size:15px">'+p.emoji+' '+p.label+'</b><div style="font-size:11px;opacity:.75;margin-top:4px">'+(own?('เจ้าของ: '+(data.ownerName||data.owner||'คุณ')):('เช่า ฿'+p.rent+'/วัน • ซื้อขาด ฿'+p.buy))+'</div>';
  if(own){
    box.appendChild(mkBtn('📦 จัดสินค้า','#5a9b3f',()=>{overlay.remove();openStockUI(plotId)}));
    box.appendChild(mkBtn('🎯 มินิเกมขาย','#f2a900',()=>{overlay.remove();openSellMinigame(plotId)}));
    box.appendChild(mkBtn('💰 เก็บเงิน (฿'+((_G('S').shopEarn&&_G('S').shopEarn[plotId])||0)+')','#3a6ea5',()=>{overlay.remove();collectCash(plotId)}));
    box.appendChild(mkBtn('ปิด','#c0392b',()=>overlay.remove()));
  } else {
    box.appendChild(mkBtn('🔑 เช่า ฿'+p.rent+'/วัน','#5a9b3f',()=>{claimPlot(plotId,'rent');overlay.remove()}));
    box.appendChild(mkBtn('🏠 ซื้อ ฿'+p.buy,'#f2a900',()=>{claimPlot(plotId,'buy');overlay.remove()}));
    box.appendChild(mkBtn('ปิด','#c0392b',()=>overlay.remove()));
  }
  overlay.onclick=ev=>{if(ev.target===overlay)overlay.remove()};
  document.body.appendChild(overlay);
};

function mkOverlay(title){
  const o=document.createElement('div');
  o.style.cssText='position:fixed;inset:0;z-index:96;background:rgba(11,23,38,.78);display:flex;align-items:center;justify-content:center;font-family:Mali,sans-serif';
  const b=document.createElement('div');
  b.style.cssText='background:#fff3d6;border:4px solid #f2a900;border-radius:14px;padding:14px 16px;width:min(94vw,420px);max-height:86vh;overflow-y:auto;color:#3a2814';
  const h=document.createElement('div');
  h.innerHTML='<b style="font-size:15px">'+title+'</b>';
  b.appendChild(h);o.appendChild(b);return o;
}
function mkBtn(t,col,fn){const b=document.createElement('button');b.textContent=t;b.style.cssText='margin:6px 4px 0 0;padding:8px 12px;border-radius:8px;border:2px solid #c79a4b;background:'+col+';color:#fff;font:600 13px Mali;cursor:pointer';b.onclick=fn||function(){};return b}

/* ============ exposed API ============ */
window.shopExt={
  drawPlots,drawNPCs,tickNPCs,claimPlot,collectCash,
  openPlotModal:window.openPlotModal,openStockUI,openSellMinigame,
  putToStock,pullFromStock,plots:EXT.plots,byId:EXT.byId,npcs:EXT.npcs
};
window.addEventListener('error',ev=>{try{console.error('[shopExt]',ev.message)}catch(e){}});
})();
