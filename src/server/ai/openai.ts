import { AiError, type AiClient } from "./types";

/**
 * OpenAI Chat Completions over plain fetch (no SDK). The API key stays on the server and is never logged.
 * gpt-5 family models are reasoning models: they take `max_completion_tokens` (not max_tokens), reject a
 * custom temperature, and spend part of the budget "thinking", so effort is set to minimal for short replies.
 */
export function createOpenAiClient(apiKey: string, model: string, reasoningEffort?: string, fetchImpl: typeof fetch = fetch): AiClient {
  const effort = reasoningEffort ?? (model.startsWith("gpt-5") ? "minimal" : undefined);
  return {
    async complete(system, turns, maxTokens) {
      let res: Response;
      try {
        res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: system }, ...turns],
            max_completion_tokens: maxTokens,
            ...(effort ? { reasoning_effort: effort } : {}),
          }),
          signal: AbortSignal.timeout(25_000),
        });
      } catch {
        throw new AiError("OpenAI is unreachable");
      }
      const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string | null } }[]; error?: { message?: string } } | null;
      if (!res.ok) throw new AiError(`OpenAI answered HTTP ${res.status}${body?.error?.message ? `: ${body.error.message.slice(0, 200)}` : ""}`);
      const text = body?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new AiError("OpenAI returned an empty reply");
      return text;
    },
  };
}
