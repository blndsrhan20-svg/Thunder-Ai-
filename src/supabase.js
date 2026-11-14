import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
const URL="https://qdadoqjecoztygckuckm.supabase.co";
const ANON_KEY="sb_publishable_is9fla7kfuUa00zjPrDk5w_P2vEAFAS";
export const supabase=createClient(URL,ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});