import { describe, expect, it } from 'vitest';
import { isLlmConfigured, isVisionConfigured, parseJsonResponse } from './llm';

const base = {
  anthropicModel: 'claude-haiku-4-5-20251001',
  geminiModel: 'gemini-2.5-flash',
  timeoutMs: 1000,
};

describe('isLlmConfigured', () => {
  it('any one provider is enough; none means off', () => {
    expect(isLlmConfigured({ ...base })).toBe(false);
    expect(isLlmConfigured({ ...base, anthropicApiKey: 'k' })).toBe(true);
    expect(isLlmConfigured({ ...base, geminiApiKey: 'k' })).toBe(true);
    expect(isLlmConfigured({ ...base, ollamaUrl: 'http://x', ollamaModel: 'llama3' })).toBe(true);
    // Ollama needs both halves.
    expect(isLlmConfigured({ ...base, ollamaUrl: 'http://x' })).toBe(false);
  });

  it('vision needs a cloud provider — a local model makes no promise', () => {
    expect(isVisionConfigured({ ...base, ollamaUrl: 'http://x', ollamaModel: 'llava' })).toBe(
      false,
    );
    expect(isVisionConfigured({ ...base, geminiApiKey: 'k' })).toBe(true);
  });
});

describe('parseJsonResponse', () => {
  it('reads clean JSON, fenced JSON, and JSON with trailing prose', () => {
    expect(parseJsonResponse('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonResponse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonResponse('Here you go: {"a":1} hope that helps!')).toEqual({ a: 1 });
    expect(parseJsonResponse('[1,2,3] and some words')).toEqual([1, 2, 3]);
  });

  it('handles braces inside strings', () => {
    expect(parseJsonResponse('{"text":"use {curly} braces"} trailing')).toEqual({
      text: 'use {curly} braces',
    });
  });

  it('returns null for prose with no JSON, rather than throwing', () => {
    expect(parseJsonResponse('I cannot answer that.')).toBeNull();
    expect(parseJsonResponse('')).toBeNull();
  });
});
