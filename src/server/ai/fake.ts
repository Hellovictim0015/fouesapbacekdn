import type { AiClient } from "./types";

/** Canned answers so the whole chat can be tried with no API key and no cost. Refused in production. */
export function createFakeAiClient(): AiClient {
  return {
    async complete(system, turns) {
      const last = turns[turns.length - 1]?.content ?? "";
      if (system.includes("clean up what an Indian student typed")) return last.toLowerCase() === "gibberish" ? "UNCLEAR" : last.replace(/\b\w/g, (c) => c.toUpperCase());
      if (system.includes("JSON array of 3 strings")) return JSON.stringify(["Fake tip: solve 10 questions on one weak topic.", "Fake motivation: steady beats rare.", "Fake nudge: start a 25-minute session?"]);
      if (system.includes("ONE short line")) return "Fake Buddy: one small session now beats a big plan later. Go!";
      return `Fake Buddy: you said "${last.slice(0, 80)}". Start a 25-minute session and tell me how it went.`;
    },
  };
}
