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
    if (p.type === "audio_url" && p.audio_url && typeof p.audio_url === "object") {
      const audio = (p.audio_url as Record<string, unknown>).url;
      const match = typeof audio === "string" ? audio.match(/^data:(audio\/(?:webm|mp4|ogg|wav|mpeg|mp3));base64,([A-Za-z0-9+/=]+)$/i) : null;
      if (match && match[0].length <= 7_000_000) {
        parts.push({ type: "audio", mimeType: match[1].toLowerCase(), data: match[2] });
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

    const containsAudio = messages.some((m: any) =>
      Array.isArray(m.content) && m.content.some((p: any) => p?.type === "audio" && typeof p.data === "string")
    );
    if (containsAudio) {
      const systemText = messages.filter((m: any) => m.role === "system")
        .map((m: any) => typeof m.content === "string" ? m.content : "").join("\n");
      const contents = messages.filter((m: any) => m.role !== "system").map((m: any) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]).map((p: any) => {
          if (p.type === "text") return { text: p.text };
          if (p.type === "image_url") {
            const raw = p.image_url?.url || "";
            const match = raw.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/i);
            return match ? { inlineData: { mimeType: match[1], data: match[2] } } : { text: "[صورة مرفقة]" };
          }
          if (p.type === "audio") return { inlineData: { mimeType: p.mimeType, data: p.data } };
          return { text: "" };
        }).filter((p: any) => p.text !== "")
      }));
      const audioResponse = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + encodeURIComponent(apiKey),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
            contents,
            generationConfig: { temperature: Math.max(0, Math.min(2, Number(input.temperature ?? 0.7))), maxOutputTokens: 4096 },
          }),
          signal: req.signal,
        },
      );
      if (!audioResponse.ok) {
        const detail = (await audioResponse.text()).slice(0, 1200);
        return new Response(JSON.stringify({ error: "Gemini audio request failed", detail }), {
          status: audioResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await audioResponse.json();
      const answer = (result.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
      const event = "data: " + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + "\n\ndata: [DONE]\n\n";
      return new Response(event, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
    }

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
      try {
        upstream = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: models[i], messages, stream: true,
              temperature: Math.max(0, Math.min(2, Number(input.temperature ?? 0.7))),
              max_tokens: 4096,
            }),
            signal: req.signal,
          },
        );
      } catch (error) {
        if (req.signal.aborted || i === models.length - 1) throw error;
        continue;
      }

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
    return new Response(JSON.stringify({ error: "AI provider temporarily unavailable. Please retry." }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
