import {supabase} from "./supabase.js";

const imageTypes=["image/jpeg","image/png","image/webp","image/gif"];
const videoTypes=["video/mp4","video/quicktime"];
const safeName=name=>(name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";

export async function loadFeed(userId,limit=30){
 const {data:posts,error}=await supabase.from("posts").select("id,user_id,caption,media_path,media_type,created_at").order("created_at",{ascending:false}).limit(limit);
 if(error)throw error;
 const rows=posts||[];if(!rows.length)return[];
 const userIds=[...new Set(rows.map(p=>p.user_id))],postIds=rows.map(p=>p.id);
 const [profiles,likes,comments,following]=await Promise.all([
  supabase.from("profiles").select("id,username,display_name,avatar_path").in("id",userIds),
  supabase.from("post_likes").select("post_id,user_id").in("post_id",postIds),
  supabase.from("post_comments").select("id,post_id,user_id,content,created_at").in("post_id",postIds).order("created_at",{ascending:true}),
  supabase.from("user_follows").select("following_id").eq("follower_id",userId).in("following_id",userIds)
 ]);
 for(const r of [profiles,likes,comments,following])if(r.error)throw r.error;
 const profileMap=new Map((profiles.data||[]).map(p=>[p.id,p]));
 const followed=new Set((following.data||[]).map(x=>x.following_id));
 const signed=await Promise.all(rows.map(async p=>p.media_path?await mediaUrl(p.media_path):null));
 return rows.map((p,i)=>({...p,author:profileMap.get(p.user_id)||{id:p.user_id,display_name:"عضو Thunder",username:""},liked_by_me:(likes.data||[]).some(x=>x.post_id===p.id&&x.user_id===userId),like_count:(likes.data||[]).filter(x=>x.post_id===p.id).length,comments:(comments.data||[]).filter(x=>x.post_id===p.id).slice(-3),comment_count:(comments.data||[]).filter(x=>x.post_id===p.id).length,following:followed.has(p.user_id),media_url:signed[i]}));
}
export async function mediaUrl(path){const {data,error}=await supabase.storage.from("thunder-social-media").createSignedUrl(path,3600);if(error)throw error;return data.signedUrl}
export async function createPost(userId,caption,file){
 let path=null,media_type="text";
 if(file){
  if(![...imageTypes,...videoTypes].includes(file.type))throw new Error("اختر صورة JPG أو PNG أو WEBP أو GIF أو فيديو MP4");
  if(file.size>50*1024*1024)throw new Error("الحد الأقصى للملف 50 ميغابايت");
  media_type=videoTypes.includes(file.type)?"video":"image";
  path=userId+"/"+crypto.randomUUID()+"."+safeName(file.name);
  const upload=await supabase.storage.from("thunder-social-media").upload(path,file,{contentType:file.type,upsert:false});
  if(upload.error)throw upload.error;
 }
 const {data,error}=await supabase.from("posts").insert({user_id:userId,caption:caption.trim(),media_path:path,media_type}).select("id,user_id,caption,media_path,media_type,created_at").single();
 if(error){if(path)await supabase.storage.from("thunder-social-media").remove([path]);throw error}
 return data;
}
export async function toggleLike(postId,userId,liked){
 const result=liked
  ?await supabase.from("post_likes").delete().eq("post_id",postId).eq("user_id",userId)
  :await supabase.from("post_likes").insert({post_id:postId,user_id:userId});
 if(result.error&&result.error.code!=="23505")throw result.error;
}
export async function addComment(postId,userId,content){
 const {data,error}=await supabase.from("post_comments").insert({post_id:postId,user_id:userId,content:content.trim()}).select("id,post_id,user_id,content,created_at").single();
 if(error)throw error;return data;
}
export async function toggleFollow(targetId,userId,following){
 const result=following
  ?await supabase.from("user_follows").delete().eq("follower_id",userId).eq("following_id",targetId)
  :await supabase.from("user_follows").insert({follower_id:userId,following_id:targetId});
 if(result.error&&result.error.code!=="23505")throw result.error;
}
export async function loadStories(userId){
 const {data:stories,error}=await supabase.from("stories").select("id,user_id,media_path,media_type,caption,created_at,expires_at").gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(60);
 if(error)throw error;
 const rows=stories||[];if(!rows.length)return[];
 const ids=[...new Set(rows.map(s=>s.user_id))],storyIds=rows.map(s=>s.id);
 const [profiles,views]=await Promise.all([
  supabase.from("profiles").select("id,username,display_name,avatar_path").in("id",ids),
  supabase.from("story_views").select("story_id,viewer_id").in("story_id",storyIds).eq("viewer_id",userId)
 ]);
 if(profiles.error)throw profiles.error;if(views.error)throw views.error;
 return Promise.all(rows.map(async s=>({...s,author:(profiles.data||[]).find(p=>p.id===s.user_id)||{},viewed:(views.data||[]).some(v=>v.story_id===s.id),media_url:await mediaUrl(s.media_path)})));
}
export async function createStory(userId,file,caption=""){
 if(!file||![...imageTypes,...videoTypes].includes(file.type))throw new Error("اختر صورة أو فيديو مدعوماً");
 if(file.size>50*1024*1024)throw new Error("الحد الأقصى للقصة 50 ميغابايت");
 const media_type=videoTypes.includes(file.type)?"video":"image";
 const path=userId+"/"+crypto.randomUUID()+"."+safeName(file.name);
 const upload=await supabase.storage.from("thunder-social-media").upload(path,file,{contentType:file.type,upsert:false});
 if(upload.error)throw upload.error;
 const {data,error}=await supabase.from("stories").insert({user_id:userId,media_path:path,media_type,caption:caption.trim()}).select().single();
 if(error){await supabase.storage.from("thunder-social-media").remove([path]);throw error}
 return data;
}
export async function markStoryViewed(storyId,userId){
 const {error}=await supabase.from("story_views").upsert({story_id:storyId,viewer_id:userId},{onConflict:"story_id,viewer_id",ignoreDuplicates:true});
 if(error)throw error;
}
export async function loadProfileSummary(userId){
 const [profile,posts,followers,following]=await Promise.all([
  supabase.from("profiles").select("id,username,display_name,bio,avatar_path,website,user_code").eq("id",userId).single(),
  supabase.from("posts").select("id",{count:"exact",head:true}).eq("user_id",userId),
  supabase.from("user_follows").select("follower_id",{count:"exact",head:true}).eq("following_id",userId),
  supabase.from("user_follows").select("following_id",{count:"exact",head:true}).eq("follower_id",userId)
 ]);
 for(const r of [profile,posts,followers,following])if(r.error)throw r.error;
 return {profile:profile.data,posts:posts.count||0,followers:followers.count||0,following:following.count||0};
}
export async function loadNotifications(userId){
 const {data,error}=await supabase.from("notifications").select("id,actor_id,kind,post_id,story_id,is_read,created_at").eq("recipient_id",userId).order("created_at",{ascending:false}).limit(40);
 if(error)throw error;const rows=data||[];const ids=[...new Set(rows.map(n=>n.actor_id).filter(Boolean))];
 const profiles=ids.length?await supabase.from("profiles").select("id,username,display_name").in("id",ids):{data:[],error:null};
 if(profiles.error)throw profiles.error;
 return rows.map(n=>({...n,actor:(profiles.data||[]).find(p=>p.id===n.actor_id)||null}));
}

export async function markNotificationsRead(userId){
 const {error}=await supabase.from("notifications").update({is_read:true}).eq("recipient_id",userId).eq("is_read",false);
 if(error)throw error;
}
export async function loadPublicProfile(targetId,currentUserId){
 const [profile,posts,followers,following,relation]=await Promise.all([
  supabase.from("profiles").select("id,username,display_name,bio,avatar_path,website,user_code").eq("id",targetId).single(),
  supabase.from("posts").select("id,user_id,caption,media_path,media_type,created_at").eq("user_id",targetId).order("created_at",{ascending:false}).limit(30),
  supabase.from("user_follows").select("follower_id",{count:"exact",head:true}).eq("following_id",targetId),
  supabase.from("user_follows").select("following_id",{count:"exact",head:true}).eq("follower_id",targetId),
  targetId===currentUserId?Promise.resolve({data:null,error:null}):supabase.from("user_follows").select("follower_id").eq("follower_id",currentUserId).eq("following_id",targetId).maybeSingle()
 ]);
 for(const r of [profile,posts,followers,following,relation])if(r.error)throw r.error;
 const rows=posts.data||[];
 const urls=await Promise.all(rows.map(p=>p.media_path?mediaUrl(p.media_path):null));
 return {profile:profile.data,posts:rows.map((p,i)=>({...p,media_url:urls[i]})),postCount:posts.data?.length||0,followers:followers.count||0,following:following.count||0,isFollowing:!!relation.data};
}
