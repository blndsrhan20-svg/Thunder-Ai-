import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured in Supabase secrets." }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const raw = await req.text();
    if (raw.length > 120_000) {
      return new Response(JSON.stringify({ error: "Request too large" }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const input = JSON.parse(raw);
    if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 60) {
      return new Response(JSON.stringify({ error: "Invalid messages" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const messages = input.messages.map((m: any) => {
      const role = m?.role === "assistant" ? "assistant" : m?.role === "system" ? "system" : "user";
      const content = typeof m?.content === "string" ? m.content.slice(0, 20000) : "";
      return { role, content };
    }).filter((m: any) => m.content.length > 0);

    // Prefer the current stable Flash model, then fall back to Flash-Lite
    // when Google reports temporary capacity or rate-limit errors.
    const models = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
    let upstream: Response | null = null;

    for (let i = 0; i < models.length; i++) {
      upstream = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: models[i], messages, stream: true,
            temperature: Math.max(0, Math.min(2, Number(input.temperature ?? 0.7))),
          }),
          signal: req.signal,
        },
      );

      const retryable = [429, 500, 502, 503, 504].includes(upstream.status);
      if (upstream.ok || !retryable || i === models.length - 1) break;
      await upstream.body?.cancel().catch(() => {});
    }

    if (!upstream) throw new Error("Gemini request was not started.");

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 1200);
      return new Response(JSON.stringify({ error: "Gemini API request failed", detail }), {
        status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "Connection": "keep-alive" },
    });
  } catch (_error) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
