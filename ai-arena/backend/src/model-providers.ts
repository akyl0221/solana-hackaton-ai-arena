import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "./config";

export interface ModelProvider {
  readonly name: string;
  generateJson(prompt: string): Promise<string>;
}

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

function getAnthropic(): Anthropic | null {
  if (!config.anthropicApiKey) return null;
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return anthropic;
}

function getOpenAI(): OpenAI | null {
  if (!config.openaiApiKey) return null;
  if (!openai) {
    openai = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openai;
}

export class AnthropicModelProvider implements ModelProvider {
  readonly name = "anthropic-live";
  private readonly client: Anthropic;

  constructor(client: Anthropic) {
    this.client = client;
  }

  async generateJson(prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: config.anthropicModel,
      max_tokens: 250,
      messages: [{ role: "user", content: prompt }],
    });

    return response.content[0].type === "text" ? response.content[0].text.trim() : "";
  }
}

export class OpenAIModelProvider implements ModelProvider {
  readonly name = "openai-live";
  private readonly client: OpenAI;

  constructor(client: OpenAI) {
    this.client = client;
  }

  async generateJson(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: config.openaiModel,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    return response.choices[0]?.message?.content?.trim() || "";
  }
}

export function resolveLiveModelProvider(): ModelProvider | null {
  if (config.aiProvider === "anthropic") {
    const client = getAnthropic();
    return client ? new AnthropicModelProvider(client) : null;
  }

  if (config.aiProvider === "openai") {
    const client = getOpenAI();
    return client ? new OpenAIModelProvider(client) : null;
  }

  const anthropicClient = getAnthropic();
  if (anthropicClient) {
    return new AnthropicModelProvider(anthropicClient);
  }

  const openaiClient = getOpenAI();
  if (openaiClient) {
    return new OpenAIModelProvider(openaiClient);
  }

  return null;
}
