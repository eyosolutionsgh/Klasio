/**
 * The one place the product talks to a language model (FEATURES.md §21).
 *
 * Mirrors the TfolaDriver assistant pattern: providers are configured by environment —
 * ANTHROPIC_API_KEY (Claude), GEMINI_API_KEY (Gemini), or OLLAMA_URL+OLLAMA_MODEL for a local
 * model on the school's own box — and every call goes through `callLlm`, so timeouts, fallback
 * order and logging are uniform. With nothing configured, `isLlmConfigured()` is false and
 * every AI feature degrades to its deterministic behaviour or says plainly that it is off.
 * A school box with no key and no internet loses suggestions, never records.
 */

export interface LlmConfig {
  anthropicApiKey?: string;
  anthropicModel: string;
  geminiApiKey?: string;
  geminiModel: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  timeoutMs: number;
}

export function llmConfigFromEnv(): LlmConfig {
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    geminiApiKey: process.env.GEMINI_API_KEY || undefined,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    ollamaUrl: process.env.OLLAMA_URL || undefined,
    ollamaModel: process.env.OLLAMA_MODEL || undefined,
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS ?? '', 10) || 20_000,
  };
}

export function isLlmConfigured(config: LlmConfig): boolean {
  return Boolean(
    config.anthropicApiKey || config.geminiApiKey || (config.ollamaUrl && config.ollamaModel),
  );
}

/** Which providers can read an image. Ollama models vary too much to promise. */
export function isVisionConfigured(config: LlmConfig): boolean {
  return Boolean(config.anthropicApiKey || config.geminiApiKey);
}

export interface LlmCallInput {
  config: LlmConfig;
  systemPrompt: string;
  userPrompt: string;
  /** Ask the provider for strict JSON output where it supports the switch. */
  jsonMode?: boolean;
  /** Optional image for vision calls (script capture). */
  image?: { mimeType: string; base64: string };
  maxTokens?: number;
  fetchFn?: typeof fetch;
}

export interface LlmCallResult {
  text: string;
  provider: 'anthropic' | 'gemini' | 'ollama';
}

/** Cloud first (Anthropic, then Gemini), local Ollama as the failover — same shape as Tfola. */
export async function callLlm(input: LlmCallInput): Promise<LlmCallResult | null> {
  const fetchFn = input.fetchFn ?? fetch;
  if (input.config.anthropicApiKey) {
    const text = await callAnthropic(input, fetchFn).catch(() => null);
    if (text) return { text, provider: 'anthropic' };
  }
  if (input.config.geminiApiKey) {
    const text = await callGemini(input, fetchFn).catch(() => null);
    if (text) return { text, provider: 'gemini' };
  }
  if (!input.image && input.config.ollamaUrl && input.config.ollamaModel) {
    const text = await callOllama(input, fetchFn).catch(() => null);
    if (text) return { text, provider: 'ollama' };
  }
  return null;
}

async function withTimeout(fetchFn: typeof fetch, url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(input: LlmCallInput, fetchFn: typeof fetch): Promise<string | null> {
  const { config } = input;
  const content: unknown[] = [];
  if (input.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: input.image.mimeType, data: input.image.base64 },
    });
  }
  content.push({ type: 'text', text: input.userPrompt });
  const res = await withTimeout(
    fetchFn,
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'x-api-key': config.anthropicApiKey!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: input.maxTokens ?? 1024,
        system: input.systemPrompt,
        messages: [{ role: 'user', content }],
      }),
    },
    config.timeoutMs,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (
    json.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim() || null
  );
}

async function callGemini(input: LlmCallInput, fetchFn: typeof fetch): Promise<string | null> {
  const { config } = input;
  const parts: unknown[] = [];
  if (input.image) {
    parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.base64 } });
  }
  parts.push({ text: input.userPrompt });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    config.geminiModel,
  )}:generateContent?key=${encodeURIComponent(config.geminiApiKey!)}`;
  const res = await withTimeout(
    fetchFn,
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: input.maxTokens ?? 1024,
          ...(input.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    },
    config.timeoutMs,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (
    json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim() || null
  );
}

async function callOllama(input: LlmCallInput, fetchFn: typeof fetch): Promise<string | null> {
  const { config } = input;
  const res = await withTimeout(
    fetchFn,
    `${config.ollamaUrl!.replace(/\/+$/, '')}/api/chat`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        ...(input.jsonMode ? { format: 'json' } : {}),
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userPrompt },
        ],
      }),
    },
    config.timeoutMs,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { message?: { content?: string } };
  return json.message?.content?.trim() || null;
}

/**
 * Parse a model's JSON answer, tolerating the fences and prefixes smaller models add.
 * Returns null rather than throwing — an unparseable answer is a fallback, not a crash.
 */
export function parseJsonResponse<T>(raw: string): T | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = stripped.search(/[[{]/);
  if (start === -1) return null;
  // Walk to the matching close so trailing prose does not break the parse.
  const open = stripped[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === open) depth++;
    if (ch === close) depth--;
    if (depth === 0) {
      try {
        return JSON.parse(stripped.slice(start, i + 1)) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}
