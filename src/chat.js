import {supabase} from "./supabase.js";
export async function listConversations(userId){const {data:rows,error}=await supabase.from("direct_conversations").select("id,member_one,member_two,last_message_at,created_at").or("member_one.eq."+userId+",member_two.eq."+userId).order("last_message_at",{ascending:false});if(error)throw error;const ids=[...new Set((rows||[]).map(r=>r.member_one===userId?r.member_two:r.member_one))];const p=ids.length?await supabase.from("profiles").select("id,username,display_name,user_code").in("id",ids):{data:[],error:null};if(p.error)throw p.error;const cids=(rows||[]).map(r=>r.id);const m=cids.length?await supabase.from("direct_messages").select("id,conversation_id,sender_id,content,image_path,audio_path,created_at").in("conversation_id",cids).order("created_at",{ascending:false}).limit(500):{data:[],error:null};if(m.error)throw m.error;return(rows||[]).map(r=>{const otherId=r.member_one===userId?r.member_two:r.member_one;return{...r,other:(p.data||[]).find(x=>x.id===otherId)||{id:otherId,display_name:"عضو Thunder"},last:(m.data||[]).find(x=>x.conversation_id===r.id)||null}})}
export async function getMessages(id){const {data,error}=await supabase.from("direct_messages").select("id,conversation_id,sender_id,content,image_path,audio_path,created_at").eq("conversation_id",id).order("created_at",{ascending:true}).limit(500);if(error)throw error;return data||[]}
export const sendMessage=(conversationId,senderId,content)=>supabase.from("direct_messages").insert({conversation_id:conversationId,sender_id:senderId,content}).select().single();
export async function findPeople(q,userId){const s=q.trim().replace(/[%,()]/g," ");if(s.length<2)return[];let query=supabase.from("profiles").select("id,username,display_name,user_code").neq("id",userId).limit(25);query=/^\d{2,8}$/.test(s)?query.ilike("user_code","%"+s+"%"):query.or("username.ilike.%"+s+"%,display_name.ilike.%"+s+"%");const {data,error}=await query;if(error)throw error;return data||[]}
export async function openDirectConversation(userId,otherId){const [one,two]=[userId,otherId].sort();const old=await supabase.from("direct_conversations").select("id").eq("member_one",one).eq("member_two",two).maybeSingle();if(old.error)throw old.error;if(old.data)return old.data.id;const made=await supabase.from("direct_conversations").insert({member_one:one,member_two:two}).select("id").single();if(!made.error)return made.data.id;if(made.error.code==="23505"){const retry=await supabase.from("direct_conversations").select("id").eq("member_one",one).eq("member_two",two).single();if(retry.error)throw retry.error;return retry.data.id}throw made.error}
export const watchMessages=(uid,fn,status)=>supabase.channel("thunder-user-"+uid).on("postgres_changes",{event:"INSERT",schema:"public",table:"direct_messages"},e=>fn({...e.new,_kind:"direct"})).on("postgres_changes",{event:"INSERT",schema:"public",table:"group_messages"},e=>fn({...e.new,_kind:"group"})).subscribe(status);
export async function sendImage(conversationId,userId,file){
 if(!["image/jpeg","image/png","image/webp","image/gif"].includes(file.type))throw new Error("الصيغ المدعومة: JPG وPNG وWEBP وGIF فقط");
 if(file.size>10*1024*1024)throw new Error("حجم الصورة يجب ألا يتجاوز 10 ميغابايت");
 const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
 const path=conversationId+"/"+userId+"/"+crypto.randomUUID()+"."+ext;
 const uploaded=await supabase.storage.from("thunder-chat-images").upload(path,file,{contentType:file.type,upsert:false});
 if(uploaded.error)throw uploaded.error;
 const inserted=await supabase.from("direct_messages").insert({conversation_id:conversationId,sender_id:userId,content:"",image_path:path}).select().single();
 if(inserted.error){await supabase.storage.from("thunder-chat-images").remove([path]);throw inserted.error}
 return inserted.data;
}
export async function signedImageUrl(path){
 const {data,error}=await supabase.storage.from("thunder-chat-images").createSignedUrl(path,3600);
 if(error)throw error;return data.signedUrl;
}

export async function listGroups(userId){
 const memberships=await supabase.from("group_members").select("group_id,role").eq("user_id",userId);
 if(memberships.error){
  // Keep direct messages and member search usable before the additive group migration is applied.
  if(memberships.error.code==="PGRST205"||memberships.error.code==="42P01"||/group_members.*schema cache|Could not find the table/i.test(memberships.error.message||""))return[];
  throw memberships.error;
 }
 const ids=(memberships.data||[]).map(x=>x.group_id);if(!ids.length)return[];
 const groups=await supabase.from("group_conversations").select("id,title,description,owner_id,created_at,updated_at").in("id",ids).order("updated_at",{ascending:false});
 if(groups.error)throw groups.error;
 const msgs=await supabase.from("group_messages").select("id,group_id,sender_id,content,image_path,audio_path,created_at").in("group_id",ids).order("created_at",{ascending:false}).limit(500);
 if(msgs.error)throw msgs.error;
 const counts=await supabase.from("group_members").select("group_id,user_id").in("group_id",ids);
 if(counts.error)throw counts.error;
 return (groups.data||[]).map(g=>({...g,last:(msgs.data||[]).find(m=>m.group_id===g.id)||null,member_count:(counts.data||[]).filter(m=>m.group_id===g.id).length}));
}
export async function createGroup(ownerId,title,description,memberIds){
 const made=await supabase.from("group_conversations").insert({owner_id:ownerId,title:title.trim(),description:(description||"").trim()}).select("id,title,description,owner_id,created_at,updated_at").single();
 if(made.error)throw made.error;
 const unique=[...new Set([ownerId,...memberIds])];
 const rows=unique.map(user_id=>({group_id:made.data.id,user_id,role:user_id===ownerId?"owner":"member"}));
 const added=await supabase.from("group_members").insert(rows);
 if(added.error){await supabase.from("group_conversations").delete().eq("id",made.data.id);throw added.error}
 return {...made.data,member_count:unique.length,last:null};
}
export const getGroupMessages=async id=>{const r=await supabase.from("group_messages").select("id,group_id,sender_id,content,image_path,created_at,edited_at,deleted_at").eq("group_id",id).order("created_at",{ascending:true}).limit(500);if(r.error)throw r.error;const ids=[...new Set((r.data||[]).map(m=>m.sender_id))];const p=ids.length?await supabase.from("profiles").select("id,username,display_name").in("id",ids):{data:[],error:null};if(p.error)throw p.error;return(r.data||[]).map(m=>({...m,sender:(p.data||[]).find(x=>x.id===m.sender_id)||null}))};
export const sendGroupMessage=(groupId,senderId,content)=>supabase.from("group_messages").insert({group_id:groupId,sender_id:senderId,content}).select().single();
export async function sendGroupImage(groupId,userId,file){
 if(!["image/jpeg","image/png","image/webp","image/gif"].includes(file.type))throw new Error("الصيغ المدعومة: JPG وPNG وWEBP وGIF فقط");
 if(file.size>10*1024*1024)throw new Error("حجم الصورة يجب ألا يتجاوز 10 ميغابايت");
 const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
 const path=groupId+"/"+userId+"/"+crypto.randomUUID()+"."+ext;
 const uploaded=await supabase.storage.from("thunder-chat-images").upload(path,file,{contentType:file.type,upsert:false});
 if(uploaded.error)throw uploaded.error;
 const inserted=await supabase.from("group_messages").insert({group_id:groupId,sender_id:userId,content:"",image_path:path}).select().single();
 if(inserted.error){await supabase.storage.from("thunder-chat-images").remove([path]);throw inserted.error}
 return inserted.data;
}
export async function markGroupRead(groupId,userId){
 const {data,error}=await supabase.from("group_messages").select("id").eq("group_id",groupId).neq("sender_id",userId).order("created_at",{ascending:false}).limit(50);
 if(error)throw error;if(!data?.length)return;
 const rows=data.map(m=>({message_id:m.id,user_id:userId}));
 const r=await supabase.from("group_message_reads").upsert(rows,{onConflict:"message_id,user_id",ignoreDuplicates:true});
 if(r.error)throw r.error;
}
export async function toggleGroupReaction(messageId,userId,emoji){
 const old=await supabase.from("group_message_reactions").select("message_id").eq("message_id",messageId).eq("user_id",userId).eq("emoji",emoji).maybeSingle();
 if(old.error)throw old.error;
 const r=old.data?await supabase.from("group_message_reactions").delete().eq("message_id",messageId).eq("user_id",userId).eq("emoji",emoji):await supabase.from("group_message_reactions").insert({message_id:messageId,user_id:userId,emoji});
 if(r.error)throw r.error;
}

export const getGroupReactions=async ids=>{if(!ids.length)return[];const r=await supabase.from("group_message_reactions").select("message_id,user_id,emoji").in("message_id",ids);if(r.error)throw r.error;return r.data||[]};

export async function sendVoiceMessage(kind,conversationId,userId,file){
 const allowed=["audio/mp4","audio/webm","audio/ogg","audio/mpeg","audio/aac"];
 if(!allowed.includes(file.type))throw new Error("صيغة التسجيل الصوتي غير مدعومة على هذا الجهاز");
 if(file.size>25*1024*1024)throw new Error("التسجيل أكبر من 25 ميغابايت");
 const ext=({"audio/mp4":"m4a","audio/webm":"webm","audio/ogg":"ogg","audio/mpeg":"mp3","audio/aac":"aac"})[file.type]||"m4a";
 const path=conversationId+"/"+userId+"/"+crypto.randomUUID()+"."+ext;
 const uploaded=await supabase.storage.from("thunder-chat-images").upload(path,file,{contentType:file.type,upsert:false});
 if(uploaded.error)throw uploaded.error;
 const table=kind==="group"?"group_messages":"direct_messages";
 const row=kind==="group"?{group_id:conversationId,sender_id:userId,content:"",audio_path:path}:{conversation_id:conversationId,sender_id:userId,content:"",audio_path:path};
 const inserted=await supabase.from(table).insert(row).select().single();
 if(inserted.error){await supabase.storage.from("thunder-chat-images").remove([path]);throw inserted.error}
 return inserted.data;
}
