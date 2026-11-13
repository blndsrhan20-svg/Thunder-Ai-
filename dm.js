const supabase=window.thunderSupabase;
const currentUser=()=>window.thunderCurrentUser?.();
const $=id=>document.getElementById(id);
let activeDM=null,dmChannel=null,dmMessages=[];
function dmInitial(name){return (name||'T').trim().slice(0,1).toUpperCase()}
async function showDMView(){
 if(!currentUser()){$('authGate').style.display='flex';return}
 if(!$('communityView').hidden)$('communityBack').click();
 $('msgs').hidden=true;$('bar').hidden=true;$('dmView').hidden=false;$('title').textContent='الرسائل';
 await loadDMContacts();
}
async function hideDMView(){
 if(dmChannel){await supabase.removeChannel(dmChannel);dmChannel=null}
 activeDM=null;dmMessages=[];$('dmView').hidden=true;$('msgs').hidden=false;$('bar').hidden=false;$('title').textContent='Thunder Ai';
}
async function loadDMContacts(){
 const me=currentUser();if(!me)return;
 const {data,error}=await supabase.from('direct_conversations').select('id,member_one,member_two,last_message_at').order('last_message_at',{ascending:false}).limit(100);
 if(error){$('dmContacts').textContent='تعذر تحميل الرسائل: '+error.message;return}
 const rows=data||[],ids=[...new Set(rows.map(x=>x.member_one===me.id?x.member_two:x.member_one))];
 let profiles=[];if(ids.length){const p=await supabase.from('profiles').select('id,display_name,username,user_code').in('id',ids);if(!p.error)profiles=p.data||[]}
 const map=new Map(profiles.map(p=>[p.id,p]));$('dmContacts').innerHTML='';
 if(!rows.length){$('dmContacts').innerHTML='<div class="community-empty">لا توجد محادثات بعد.<br>ابحث عن عضو وابدأ أول رسالة.</div>';return}
 rows.forEach(row=>{const other=row.member_one===me.id?row.member_two:row.member_one,p=map.get(other)||{},b=document.createElement('button');b.className='dm-contact'+(activeDM?.id===row.id?' active':'');b.onclick=()=>openDMThread(row,p);const av=document.createElement('span');av.className='dm-avatar';av.textContent=dmInitial(p.display_name||p.username);const info=document.createElement('span');info.className='dm-contact-info';const nm=document.createElement('b');nm.textContent=p.display_name||p.username||'عضو ثاندر';const id=document.createElement('small');id.textContent=p.user_code||'';info.append(nm,id);b.append(av,info);$('dmContacts').appendChild(b)})
}
async function openDirectMessage(member){
 const me=currentUser();if(!me||!member?.id)return;
 if($('communitySearchDialog').open)$('communitySearchDialog').close();
 await showDMView();
 let q=await supabase.from('direct_conversations').select('id,member_one,member_two,last_message_at').eq('member_one',me.id).eq('member_two',member.id).maybeSingle();
 if(q.error)throw q.error;
 if(!q.data){q=await supabase.from('direct_conversations').select('id,member_one,member_two,last_message_at').eq('member_one',member.id).eq('member_two',me.id).maybeSingle();if(q.error)throw q.error}
 let conversation=q.data;
 if(!conversation){const first=me.id<member.id?me.id:member.id,second=me.id<member.id?member.id:me.id;const made=await supabase.from('direct_conversations').insert({member_one:first,member_two:second}).select('id,member_one,member_two,last_message_at').single();if(made.error)throw made.error;conversation=made.data}
 await openDMThread(conversation,member);await loadDMContacts();
}
async function openDMThread(conversation,member){
 if(dmChannel)await supabase.removeChannel(dmChannel);
 activeDM=conversation;dmMessages=[];
 $('dmThreadHead').textContent=member.display_name||member.username||'محادثة خاصة';
 $('dmInput').disabled=false;$('dmSend').disabled=false;
 const {data,error}=await supabase.from('direct_messages').select('id,conversation_id,sender_id,content,image_path,created_at').eq('conversation_id',conversation.id).order('created_at',{ascending:true}).limit(100);
 if(error){$('dmMessages').textContent='تعذر تحميل الرسائل: '+error.message;return}
 dmMessages=data||[];await renderDMMessages();
 dmChannel=supabase.channel('dm-'+conversation.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'direct_messages',filter:'conversation_id=eq.'+conversation.id},async p=>{if(!dmMessages.some(m=>m.id===p.new.id)){dmMessages.push(p.new);await renderDMMessages()}}).subscribe();
}
async function renderDMMessages(){
 const me=currentUser(),host=$('dmMessages');host.innerHTML='';
 if(!dmMessages.length){host.innerHTML='<div class="community-empty">ابدأ المحادثة برسالة لطيفة أو صورة.</div>';return}
 for(const m of dmMessages){
  const b=document.createElement('div');b.className='dm-bubble'+(m.sender_id===me.id?' mine':'');
  if(m.content){const t=document.createElement('div');t.textContent=m.content;b.appendChild(t)}
  if(m.image_path){const {data,error}=await supabase.storage.from('thunder-chat-images').createSignedUrl(m.image_path,3600);if(!error&&data?.signedUrl){const im=document.createElement('img');im.src=data.signedUrl;im.alt='صورة مرسلة';b.appendChild(im)}}
  const tm=document.createElement('div');tm.className='dm-time';tm.textContent=new Date(m.created_at).toLocaleTimeString('ar-IQ',{hour:'2-digit',minute:'2-digit'});b.appendChild(tm);host.appendChild(b);
 }
 host.scrollTop=host.scrollHeight;
}
async function sendDM(event){
 event.preventDefault();if(!activeDM)return;
 const me=currentUser(),content=$('dmInput').value.trim(),file=$('dmImageInput').files?.[0];
 if(!content&&!file)return;
 if(file&&(!file.type.startsWith('image/')||file.size>10*1024*1024)){alert('اختر صورة لا يتجاوز حجمها 10MB');return}
 $('dmSend').disabled=true;
 try{
  let image_path=null;
  if(file){const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';image_path=activeDM.id+'/'+me.id+'/'+crypto.randomUUID()+'.'+ext;const up=await supabase.storage.from('thunder-chat-images').upload(image_path,file,{contentType:file.type,upsert:false});if(up.error)throw up.error}
  const ins=await supabase.from('direct_messages').insert({conversation_id:activeDM.id,sender_id:me.id,content,image_path}).select('id,conversation_id,sender_id,content,image_path,created_at').single();
  if(ins.error)throw ins.error;
  if(!dmMessages.some(m=>m.id===ins.data.id)){dmMessages.push(ins.data);await renderDMMessages()}
  $('dmInput').value='';$('dmImageInput').value='';await loadDMContacts();
 }catch(error){alert('تعذر إرسال الرسالة: '+error.message)}
 finally{$('dmSend').disabled=false}
}
window.openThunderDM=member=>openDirectMessage(member).catch(e=>alert('تعذر فتح المحادثة: '+e.message));
$('dmOpen').addEventListener('click',()=>showDMView().catch(e=>alert(e.message)));
$('dmBack').addEventListener('click',hideDMView);
$('dmComposer').addEventListener('submit',sendDM);
$('dmImageBtn').addEventListener('click',()=>$('dmImageInput').click());
$('dmImageInput').addEventListener('change',()=>{const f=$('dmImageInput').files?.[0];if(f&&(!f.type.startsWith('image/')||f.size>10*1024*1024)){alert('الصورة يجب أن تكون أقل من 10MB');$('dmImageInput').value=''}});
$('dmInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('dmComposer').requestSubmit()}});
