/* เวลาทดลองเล่นของผู้ที่ยังไม่ล็อกอิน: นับเฉพาะตอนเปิดหน้าเกมค้างอยู่ (ฝั่งเซิร์ฟเวอร์เป็นคนนับจริง) หมดเวลาแล้วต้องสมัครสมาชิกก่อนเล่นต่อ */
(function(){
  try{var sp=+new URLSearchParams(location.search).get('split');if(sp>=2)return}catch(e){}
  var chip,over,left=null,warned=0,timer=0;
  function el(css,html){var d=document.createElement('div');d.style.cssText=css;if(html)d.innerHTML=html;document.body.appendChild(d);return d}
  function fmt(s){var m=Math.ceil(s/60);return m>=60?Math.floor(m/60)+' ชม. '+(m%60)+' นาที':m+' นาที'}
  function showChip(){
    if(!chip)chip=el('position:fixed;left:8px;bottom:8px;z-index:99998;background:rgba(28,35,64,.88);color:#f4ead0;font:13px/1.4 Pridi,Tahoma,sans-serif;padding:5px 10px;border-radius:14px;pointer-events:none');
    chip.textContent='⏳ ทดลองเล่น เหลือ '+fmt(left)+' • สมัครสมาชิกเพื่อเล่นไม่จำกัด';
    chip.style.background=left<=300?'rgba(160,40,30,.92)':'rgba(28,35,64,.88)';
  }
  function end(){
    clearInterval(timer);if(chip)chip.remove();if(over)return;
    over=el('position:fixed;inset:0;z-index:99999;background:rgba(14,18,38,.94);display:grid;place-items:center;padding:24px;text-align:center;color:#f4ead0;font:17px/1.7 Pridi,Tahoma,sans-serif',
      '<div style="max-width:420px"><div style="font-size:40px">🌾</div><h2 style="margin:6px 0 8px;font-size:24px">หมดเวลาทดลองเล่นแล้ว</h2><p style="margin:0 0 14px">สมัครสมาชิกฟรีเพื่อเล่นต่อ ความคืบหน้าในเครื่องนี้ยังอยู่ และอัปโหลดเป็นเซฟออนไลน์ได้หลังสมัคร</p><a href="/" target="_top" style="display:inline-block;background:#e8b84a;color:#2b1d12;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700">ไปสมัครสมาชิก</a></div>');
    try{window._paused=true}catch(e){}
  }
  function apply(j){
    if(!j||!j.ok||j.member||!j.on){if(chip)chip.remove();clearInterval(timer);return}
    left=j.left;if(left<=0)return end();
    showChip();
    if(left<=600&&warned<1){warned=1;toast('⏳ เหลือเวลาทดลองเล่นไม่ถึง 10 นาที เซฟเกมไว้ด้วยนะ')}
    if(left<=120&&warned<2){warned=2;toast('⏳ เหลือเวลาทดลองเล่น 2 นาที')}
  }
  function toast(t){var d=el('position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99998;background:#a02818;color:#fff;font:15px Pridi,Tahoma,sans-serif;padding:8px 16px;border-radius:10px;max-width:90vw;text-align:center',t);setTimeout(function(){d.remove()},5000)}
  function tick(){
    if(document.visibilityState!=='visible')return;
    fetch('/api/auth/guest-tick',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(apply).catch(function(){})
  }
  function start(){tick();timer=setInterval(tick,30000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
