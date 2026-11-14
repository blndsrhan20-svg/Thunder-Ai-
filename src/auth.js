import {supabase} from "./supabase.js";
export const signIn=(email,password)=>supabase.auth.signInWithPassword({email,password});
export const signUp=(email,password)=>supabase.auth.signUp({email,password});
export const signOut=()=>supabase.auth.signOut();
export const getSession=()=>supabase.auth.getSession();
export const loadProfile=id=>supabase.from("profiles").select("id,username,display_name,user_code").eq("id",id).maybeSingle();
export function saveProfile(id,displayName,username,exists){const data={display_name:displayName.trim(),username:username.trim().toLowerCase()};return exists?supabase.from("profiles").update(data).eq("id",id).select("id,username,display_name,user_code").single():supabase.from("profiles").insert({id,...data}).select("id,username,display_name,user_code").single()}