(function(){
  'use strict';

  function isLoginButton(el){
    if(!el) return false;
    var text=(el.textContent||'').replace(/\s+/g,' ').trim();
    return text.includes('เข้าสู่ระบบ') || text.toLowerCase().includes('login');
  }

  function getLoginForm(){
    var forms=Array.prototype.slice.call(document.querySelectorAll('form'));
    for(var i=0;i<forms.length;i++){
      var form=forms[i];
      var password=form.querySelector('input[type="password"]');
      if(password) return form;
    }
    return null;
  }

  function setError(message){
    var box=document.querySelector('.err');
    if(box){
      box.textContent=message||'เข้าสู่ระบบไม่สำเร็จ';
      box.style.display='block';
    }else{
      alert(message||'เข้าสู่ระบบไม่สำเร็จ');
    }
  }

  function clearError(){
    var box=document.querySelector('.err');
    if(box){box.textContent='';box.style.display='none';}
  }

  async function doLogin(form){
    if(form.__mariLoginBusy) return;
    form.__mariLoginBusy=true;
    clearError();

    var usernameInput=form.querySelector('input[name="username"],#username,input[type="text"]');
    var passwordInput=form.querySelector('input[name="password"],#password,input[type="password"]');
    var button=form.querySelector('button[type="submit"],button.btn,input[type="submit"]');
    var username=String(usernameInput&&usernameInput.value||'').trim();
    var password=String(passwordInput&&passwordInput.value||'');

    if(!username || !password){
      setError('กรุณากรอก Username และ Password');
      form.__mariLoginBusy=false;
      return;
    }

    if(button){button.disabled=true;button.dataset.mariOldText=button.textContent;button.textContent='กำลังเข้าสู่ระบบ...';}

    try{
      var response=await fetch('/api/login',{
        method:'POST',
        credentials:'include',
        headers:{'Content-Type':'application/json'},
        cache:'no-store',
        body:JSON.stringify({username:username,password:password})
      });
      var data=await response.json().catch(function(){return {};});

      if(!response.ok || !data.success){
        throw new Error(data.error||'Username หรือ Password ไม่ถูกต้อง');
      }

      // Confirm the browser can send the new session cookie back to the Worker.
      var me=await fetch('/api/me',{method:'GET',credentials:'include',cache:'no-store'});
      var meData=await me.json().catch(function(){return {};});
      if(!me.ok || !meData.user){
        throw new Error('เข้าสู่ระบบสำเร็จ แต่ Session ไม่ถูกส่งกลับไปยังเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง');
      }

      // Keep a small client-side copy for pages that use the existing UI state.
      try{localStorage.setItem('mariUser',JSON.stringify(meData.user));}catch(e){}

      window.location.replace('/');
    }catch(error){
      console.error('[mari-auth-fix]',error);
      setError(error&&error.message?error.message:'ระบบบัญชีขัดข้องชั่วคราว');
      form.__mariLoginBusy=false;
      if(button){button.disabled=false;button.textContent=button.dataset.mariOldText||'เข้าสู่ระบบ';}
    }
  }

  function intercept(event){
    var target=event.target;
    var button=target&&target.closest?target.closest('button,input[type="submit"]'):null;
    var form=target&&target.closest?target.closest('form'):null;
    if(!form) form=getLoginForm();
    if(!form) return;

    if(event.type==='submit' || isLoginButton(button)){
      event.preventDefault();
      event.stopImmediatePropagation();
      doLogin(form);
    }
  }

  document.addEventListener('click',intercept,true);
  document.addEventListener('submit',intercept,true);
})();
