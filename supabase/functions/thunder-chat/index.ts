import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizeContent(value: unknown): string | Array<Record<string, unknown>> {
  if (typeof value === "string") return value.slice(0, 20000);
  if (!Array.isArray(value)) return "";
  const parts: Array<Record<string, unknown>> = [];
  for (const part of value.slice(0, 9)) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      parts.push({ type: "text", text: p.text.slice(0, 20000) });
      continue;
    }
    if (p.type === "image_url" && p.image_url && typeof p.image_url === "object") {
      const image = (p.image_url as Record<string, unknown>).url;
      // Only accept inline image data from the authenticated client; do not fetch arbitrary URLs.
      if (typeof image === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(image) && image.length <= 8_500_000) {
        parts.push({ type: "image_url", image_url: { url: image } });
      }
    }
  }
  return parts;
}

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
    if (raw.length > 12_000_000) {
      return new Response(JSON.stringify({ error: "Request too large (12MB limit)." }), {
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
      return { role, content: normalizeContent(m?.content) };
    }).filter((m: any) => typeof m.content === "string" ? m.content.length > 0 : m.content.length > 0);

    // Route short everyday requests to Flash-Lite for lower latency; keep Flash for complex work.
    const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
    const promptText = typeof lastUser?.content === "string" ? lastUser.content : "";
    const complexTask = promptText.length > 220 ||
      /(كود|برمج|حلل|حلّل|مشروع|قارن|خطوات|اشرح بالتفصيل|debug|code|build|analy[sz]e|compare|architecture)/i.test(promptText);
    const models = complexTask
      ? ["gemini-3.8-flash", "gemini-3.5-flash-lite"]
      : ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
    let upstream: Response | null = null;

    for (let i = 0; i < models.length; i++) {
      upstream = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: models[i], messages, stream: true,
            temperature: Math.max(0, Math.min(2, Number(input.temperature ?? 0.7))),\n            max_tokens: 4096,
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
      headers: { ...corsHeaders, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" },
    });
  } catch (_error) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
