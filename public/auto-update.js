/* รีเฟรชอัตโนมัติเมื่อมีเวอร์ชันใหม่: ถามเซิร์ฟเวอร์ (/api/ver) เป็นระยะ • เน็ตหลุด/ตอบไม่ได้ = ไม่ทำอะไร (ไม่รีเฟรชจนเจอหน้า offline)
   เจอเวอร์ชันใหม่ → นับถอยหลัง 10 วิ (กด "รีเฟรชเลย" หรือ "เลื่อน" ได้) • เกมเซฟตอนปิดหน้าอยู่แล้ว (pagehide) */
(function(){
  if(window.__bssjAU)return;window.__bssjAU=1;
  var base=null,busy=false,POLL=45000,LATER=180000,timer=null,cd=null,bar=null;
  function ver(){return fetch('/api/ver',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){return j&&j.v?String(j.v):null}).catch(function(){return null})}
  function css(e,s){e.style.cssText=s;return e}
  function btn(t,f,main){var b=document.createElement('button');b.type='button';b.textContent=t;b.onclick=f;css(b,'font:inherit;border:0;border-radius:8px;padding:5px 11px;cursor:pointer;'+(main?'background:#f2b134;color:#2a1c00;font-weight:700':'background:#ffffff26;color:#fff'));return b}
  function hide(){if(bar){bar.remove();bar=null}if(cd){clearInterval(cd);cd=null}}
  function reloadNow(){
    ver().then(function(v){ // ยืนยันว่าเน็ตยังอยู่ก่อนรีเฟรชจริง
      if(!v){hide();busy=false;return}
      try{location.reload()}catch(e){}
    })
  }
  function offer(){
    if(bar)return;var n=10;
    bar=css(document.createElement('div'),'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147483000;max-width:92vw;background:#0f2238f2;color:#fff;border:2px solid #f2b134;border-radius:14px;padding:9px 13px;font:600 13px/1.4 sans-serif;box-shadow:0 4px 0 #0008;display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center');
    bar.setAttribute('role','status');
    var tx=document.createElement('span');bar.appendChild(tx);
    var paint=function(){tx.textContent='🔄 มีเวอร์ชันใหม่ของเกม — จะรีเฟรชใน '+n+' วินาที (เซฟให้อัตโนมัติ)'};paint();
    bar.appendChild(btn('รีเฟรชเลย',function(){hide();reloadNow()},1));
    bar.appendChild(btn('เลื่อน',function(){hide();busy=false;schedule(LATER)}));
    (document.body||document.documentElement).appendChild(bar);
    cd=setInterval(function(){n--;if(n<=0){hide();reloadNow()}else paint()},1000);
  }
  function check(){
    if(busy)return;
    ver().then(function(v){
      if(!v)return; // เน็ตหลุด/เซิร์ฟเวอร์ไม่ตอบ → ข้ามรอบนี้
      if(base===null){base=v;return}
      if(v!==base){busy=true;offer()}
    })
  }
  function schedule(ms){clearTimeout(timer);timer=setTimeout(function(){check();schedule(POLL)},ms||POLL)}
  ver().then(function(v){base=v;schedule(POLL)});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)check()});
  addEventListener('online',function(){setTimeout(check,1500)});
})();
