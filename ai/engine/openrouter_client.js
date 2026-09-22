"use strict";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "~openai/gpt-latest";

class OpenRouterError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "OpenRouterError";
    this.details = details;
  }
}

function extractText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    const text = content
      .map(part => (part && typeof part.text === "string" ? part.text.trim() : ""))
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }

  throw new OpenRouterError("OpenRouter response does not contain assistant text");
}

class OpenRouterClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    this.baseUrl = String(
      options.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    this.model = options.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
    this.siteUrl = options.siteUrl ?? process.env.OPENROUTER_SITE_URL ?? "";
    this.appTitle = options.appTitle ?? process.env.OPENROUTER_APP_TITLE ?? "Age of Brutality";
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  headers() {
    if (!this.apiKey) {
      throw new OpenRouterError(
        "OPENROUTER_API_KEY is not configured. Put it in the runtime secret store."
      );
    }
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json"
    };
    if (this.siteUrl) headers["HTTP-Referer"] = this.siteUrl;
    if (this.appTitle) headers["X-OpenRouter-Title"] = this.appTitle;
    return headers;
  }

  async chat(messages, options = {}) {
    if (typeof fetch !== "function") {
      throw new OpenRouterError("OpenRouterClient requires a runtime with global fetch (Node 18+).");
    }

    const payload = {
      model: options.model || this.model,
      messages,
      ...(options.parameters || {})
    };
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new OpenRouterError(
        data?.error?.message || data?.message || `OpenRouter API HTTP ${response.status}`,
        data
      );
    }
    return data;
  }

  async ask(prompt, options = {}) {
    const messages = [];
    if (options.system) messages.push({ role: "system", content: options.system });
    messages.push({ role: "user", content: prompt });
    return extractText(await this.chat(messages, options));
  }
}

module.exports = {
  OpenRouterClient,
  OpenRouterError,
  extractText,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL
};
