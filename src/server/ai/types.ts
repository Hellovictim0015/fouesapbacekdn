export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiClient {
  /** One reply from the model. Rejects with [AiError] when the provider is down, out of quota or refuses. */
  complete(system: string, turns: ChatTurn[], maxTokens: number): Promise<string>;
}

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}
