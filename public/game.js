const $=s=>document.querySelector(s);const modal=$('#modal'),content=$('#modalContent');
(function addLoginEntry(){const grid=document.querySelector('.quick-grid');if(grid&&!grid.querySelector('[data-panel="login"]'))grid.insertAdjacentHTML('afterbegin','<button class="feature" data-panel="login" type="button"><span>🔐</span><div><b>เข้าสู่ระบบ</b><small>ผู้เล่น / Admin</small></div><strong>›</strong></button>')})();
function show(html){content.innerHTML=html;modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false')}
function hide(){modal.classList.add('hidden');modal.setAttribute('aria-hidden','true')}
function goGame(){const room=(localStorage.getItem('bsj_room')||'').trim();const name=(localStorage.getItem('bsj_name')||'ผู้เล่น').trim()||'ผู้เล่น';let url='./game-core/baan-suan-sukjai-core.html';if(room)url+='?room='+encodeURIComponent(room)+'&name='+encodeURIComponent(name);window.location.href=url}
let onlineSocket=null;let onlinePlayerId=null;
function wsUrl(room,name){const proto=location.protocol==='https:'?'wss:':'ws:';return `${proto}//${location.host}/ws/${encodeURIComponent(room)}?name=${encodeURIComponent(name)}`}
async function onlineConnect(){const me=await authMe();if(!me||me.role!=='user'){loginOpen();return}const room=(document.querySelector('#roomId')?.value||'').trim().toLowerCase();const name=(localStorage.getItem('bsj_name')||'ผู้เล่น').trim()||'ผู้เล่น';if(!room)return alert('กรุณาใส่รหัสห้อง');if(me.room&&me.room!==room)return alert('ID นี้ผูกกับห้อง '+me.room+' อยู่แล้ว');localStorage.setItem('bsj_room',room);if(onlineSocket)try{onlineSocket.close()}catch{}onlineSocket=new WebSocket(wsUrl(room,name));onlineSocket.onopen=()=>{const s=document.querySelector('#onlineStatus');if(s)s.innerHTML='🟢 เชื่อมต่อห้อง <b>'+room+'</b> สำเร็จ';const b=document.querySelector('#onlineConnectBtn');if(b)b.textContent='เชื่อมต่อแล้ว'};onlineSocket.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.type==='welcome'){onlinePlayerId=d.playerId;const s=document.querySelector('#onlineStatus');if(s)s.innerHTML='🟢 ออนไลน์ • ห้อง <b>'+room+'</b> • ผู้เล่นในห้อง '+d.players.length}if(d.type==='player:join'){const s=document.querySelector('#onlineStatus');if(s)s.innerHTML='🟢 มีผู้เล่นเข้าห้องแล้ว • ห้อง <b>'+room+'</b>'}if(d.type==='player:leave'){const s=document.querySelector('#onlineStatus');if(s)s.innerHTML='🟢 ผู้เล่นออกจากห้อง • ห้อง <b>'+room+'</b>'}}catch{}};onlineSocket.onclose=()=>{const s=document.querySelector('#onlineStatus');if(s)s.innerHTML='⚪ ตัดการเชื่อมต่อห้อง'};onlineSocket.onerror=()=>{const s=document.querySelector('#onlineStatus');if(s)s.innerHTML='🔴 เชื่อมต่อไม่สำเร็จ — ตรวจสอบว่า Cloudflare deploy เวอร์ชันล่าสุดแล้ว'}}
function onlineOpen(){const room=localStorage.getItem('bsj_room')||'';show('<h2>🌐 เล่นออนไลน์</h2><p>ใช้รหัสเดียวกันกับเพื่อนเพื่อเข้าห้องเดียวกัน</p><input class="name-input" id="roomId" placeholder="รหัสห้อง เช่น 1234" value="'+room.replace(/"/g,'&quot;')+'"><div id="onlineStatus" class="online-status">⚪ ยังไม่ได้เชื่อมต่อ</div><button id="onlineConnectBtn" class="modal-action" onclick="onlineConnect()">🌐 สร้าง/เข้าห้อง</button><button class="modal-action" onclick="goGame()">🎮 เข้าเกมออนไลน์</button>')}
document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>{const p=b.dataset.panel;if(p==='login')loginOpen();if(p==='online')onlineOpen();if(p==='world')show('<h2>🗺️ โลกของเรา</h2><p>ฟาร์ม เมือง ป่า แม่น้ำ ชายหาด ร้านค้า และบ้านของตัวละครจะเชื่อมเข้ากับโลกเกมหลัก</p><button class="modal-action" onclick="location.href=\'./game-core/baan-suan-sukjai-core.html#map\'">เข้าโลกเกม</button>');if(p==='characters')show('<h2>💗 ตัวละคร</h2><p>ตัวละครทั้งหมดจะใช้ดีไซน์ 2D ของเกมเราเอง พร้อมระบบความสัมพันธ์ ของขวัญ และเหตุการณ์ต่าง ๆ</p><button class="modal-action" onclick="location.href=\'./game-core/baan-suan-sukjai-core.html#characters\'">ดูในเกม</button>')});$('#playBtn').onclick=goGame;$('#closeModal').onclick=hide;modal.onclick=e=>{if(e.target===modal)hide};
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}))}


async function authMe(){
  try{const r=await fetch('./api/auth/me',{credentials:'same-origin'});return r.ok?await r.json():null}catch{return null}
}
function authUid(){
  let id=localStorage.getItem('bsj_uid');
  if(!id){
    id='U-'+crypto.randomUUID().replace(/-/g,'').slice(0,12).toUpperCase();
    localStorage.setItem('bsj_uid',id);
  }
  return id;
}
async function loginOpen(){
  const me=await authMe();
  const uid=authUid();
  const room=localStorage.getItem('bsj_room')||'';
  show('<h2>🔐 เข้าสู่ระบบ</h2><p>ผู้เล่นใช้ ID ผูกกับรหัสห้อง ส่วน Admin ใช้ ID และรหัสผ่าน</p><div style="display:grid;gap:8px"><input class="name-input" id="authId" placeholder="ID ผู้ใช้ / Admin" value="'+(me?.userId||uid)+'"><input class="name-input" id="authRoom" placeholder="รหัสห้อง" value="'+(me?.room||room)+'"><input class="name-input" id="authPassword" type="password" placeholder="รหัสผ่าน Admin (ผู้เล่นไม่ต้องกรอก)"></div><div id="authStatus" class="online-status">'+(me?('🟢 '+me.role+' • '+me.userId):'⚪ ยังไม่ได้เข้าสู่ระบบ')+'</div><button class="modal-action" onclick="authLogin()">🔐 เข้าสู่ระบบ</button><button class="modal-action" onclick="authLogout()">ออกจากระบบ</button>');
}
async function authLogin(){
  const id=(document.querySelector('#authId')?.value||'').trim();
  const room=(document.querySelector('#authRoom')?.value||'').trim().toLowerCase();
  const password=document.querySelector('#authPassword')?.value||'';
  const s=document.querySelector('#authStatus');
  try{
    const r=await fetch('./api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,room,password})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'เข้าสู่ระบบไม่สำเร็จ');
    if(d.role==='user'){
      localStorage.setItem('bsj_uid',d.userId);
      localStorage.setItem('bsj_room',d.room);
    }
    if(s)s.innerHTML='🟢 เข้าสู่ระบบแล้ว • '+d.role+' • '+d.userId;
    alert('เข้าสู่ระบบสำเร็จ');
  }catch(e){if(s)s.innerHTML='🔴 '+e.message}
}
async function authLogout(){
  try{await fetch('./api/auth/logout',{method:'POST',credentials:'same-origin'})}catch{}
  const s=document.querySelector('#authStatus');if(s)s.innerHTML='⚪ ออกจากระบบแล้ว';
}
async function adminOpen(){
  const me=await authMe();
  if(!me||me.role!=='admin'){loginOpen();return}
  show('<h2>🛡️ Admin</h2><p>จัดการผู้เล่นและห้อง</p><input class="name-input" id="adminRoom" placeholder="รหัสห้อง"><input class="name-input" id="adminUser" placeholder="ID ผู้เล่น"><input class="name-input" id="adminName" placeholder="ชื่อใหม่ (ใช้กับ rename)"><div id="adminStatus" class="online-status">⚪ เลือกคำสั่ง</div><button class="modal-action" onclick="adminAction('list')">👥 ดูผู้เล่น</button><button class="modal-action" onclick="adminAction('kick')">👢 เตะ</button><button class="modal-action" onclick="adminAction('ban')">⛔ แบน</button><button class="modal-action" onclick="adminAction('unban')">✅ ปลดแบน</button><button class="modal-action" onclick="adminAction('rename')">✏️ เปลี่ยนชื่อ</button>');
}
async function adminAction(action){
  const room=(document.querySelector('#adminRoom')?.value||'').trim().toLowerCase();
  const userId=(document.querySelector('#adminUser')?.value||'').trim();
  const name=(document.querySelector('#adminName')?.value||'').trim();
  const s=document.querySelector('#adminStatus');
  try{
    const r=await fetch('./api/admin/action',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,room,userId,name})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'คำสั่งไม่สำเร็จ');
    if(action==='list')s.innerHTML='🟢 ออนไลน์ '+d.count+' คน<br>'+d.online.map(x=>x.userId+' — '+x.name).join('<br>')+(d.bans.length?' <br>⛔ แบน '+d.bans.length+' คน':'');
    else s.innerHTML='🟢 '+action+' สำเร็จ • '+(d.userId||'');
  }catch(e){s.innerHTML='🔴 '+e.message}
}
