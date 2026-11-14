import {supabase} from "./supabase.js";
export async function listConversations(userId){const {data:rows,error}=await supabase.from("direct_conversations").select("id,member_one,member_two,last_message_at,created_at").or("member_one.eq."+userId+",member_two.eq."+userId).order("last_message_at",{ascending:false});if(error)throw error;const ids=[...new Set((rows||[]).map(r=>r.member_one===userId?r.member_two:r.member_one))];const p=ids.length?await supabase.from("profiles").select("id,username,display_name,user_code").in("id",ids):{data:[],error:null};if(p.error)throw p.error;const cids=(rows||[]).map(r=>r.id);const m=cids.length?await supabase.from("direct_messages").select("id,conversation_id,sender_id,content,created_at").in("conversation_id",cids).order("created_at",{ascending:false}).limit(500):{data:[],error:null};if(m.error)throw m.error;return(rows||[]).map(r=>{const otherId=r.member_one===userId?r.member_two:r.member_one;return{...r,other:(p.data||[]).find(x=>x.id===otherId)||{id:otherId,display_name:"عضو Thunder"},last:(m.data||[]).find(x=>x.conversation_id===r.id)||null}})}
export async function getMessages(id){const {data,error}=await supabase.from("direct_messages").select("id,conversation_id,sender_id,content,image_path,created_at").eq("conversation_id",id).order("created_at",{ascending:true}).limit(500);if(error)throw error;return data||[]}
export const sendMessage=(conversationId,senderId,content)=>supabase.from("direct_messages").insert({conversation_id:conversationId,sender_id:senderId,content}).select().single();
export async function findPeople(q,userId){const s=q.trim().replace(/[%,()]/g," ");if(s.length<2)return[];let query=supabase.from("profiles").select("id,username,display_name,user_code").neq("id",userId).limit(25);query=/^\d{2,8}$/.test(s)?query.ilike("user_code","%"+s+"%"):query.or("username.ilike.%"+s+"%,display_name.ilike.%"+s+"%");const {data,error}=await query;if(error)throw error;return data||[]}
export async function openDirectConversation(userId,otherId){const [one,two]=[userId,otherId].sort();const old=await supabase.from("direct_conversations").select("id").eq("member_one",one).eq("member_two",two).maybeSingle();if(old.error)throw old.error;if(old.data)return old.data.id;const made=await supabase.from("direct_conversations").insert({member_one:one,member_two:two}).select("id").single();if(!made.error)return made.data.id;if(made.error.code==="23505"){const retry=await supabase.from("direct_conversations").select("id").eq("member_one",one).eq("member_two",two).single();if(retry.error)throw retry.error;return retry.data.id}throw made.error}
export const watchMessages=(uid,fn,status)=>supabase.channel("thunder-user-"+uid).on("postgres_changes",{event:"INSERT",schema:"public",table:"direct_messages"},e=>fn(e.new)).subscribe(status);
export async function sendImage(conversationId,userId,file){
 if(!file.type.startsWith("image/"))throw new Error("يمكن إرسال الصور فقط حالياً");
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
