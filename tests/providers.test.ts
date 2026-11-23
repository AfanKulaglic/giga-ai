import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS, aiSetupHint, isAIProviderId, resolveAI } from '@/lib/config/providers';

describe('AI provider presets', () => {
  it('defaults to Groq preset details', () => {
    const p = AI_PROVIDERS.groq;
    expect(p.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(p.keyEnv).toBe('GROQ_API_KEY');
    expect(p.model).toContain('gpt-oss');
  });

  it('infers the provider from the key that is present', () => {
    expect(resolveAI({ GROQ_API_KEY: 'gsk_test' }).provider).toBe('groq');
    expect(resolveAI({ GEMINI_API_KEY: 'abc' }).provider).toBe('gemini');
    expect(resolveAI({}).provider).toBe('deepseek');
  });

  it('uses Groq base url and key without extra configuration', () => {
    const ai = resolveAI({ GROQ_API_KEY: 'gsk_test' });
    expect(ai.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(ai.apiKey).toBe('gsk_test');
    expect(ai.model).toBe('openai/gpt-oss-120b');
  });

  it('lets AI_PROVIDER and AI_MODEL override everything', () => {
    const ai = resolveAI({
      AI_PROVIDER: 'groq',
      AI_MODEL: 'openai/gpt-oss-20b',
      GROQ_API_KEY: 'gsk_test',
      AI_BASE_URL: 'https://proxy.example.com/v1/',
    });
    expect(ai.model).toBe('openai/gpt-oss-20b');
    expect(ai.baseUrl).toBe('https://proxy.example.com/v1');
  });

  it('works without a key for a local Ollama endpoint', () => {
    const ai = resolveAI({ AI_PROVIDER: 'ollama' });
    expect(ai.apiKey).toBe('ollama');
    expect(ai.baseUrl).toBe('http://localhost:11434/v1');
    expect(ai.keyEnv).toBeNull();
  });

  it('keeps DeepSeek legacy variables working', () => {
    const ai = resolveAI({ DEEPSEEK_API_KEY: 'sk-old', DEEPSEEK_MODEL: 'deepseek-reasoner' });
    expect(ai.provider).toBe('deepseek');
    expect(ai.apiKey).toBe('sk-old');
    expect(ai.model).toBe('deepseek-reasoner');
  });

  it('tightens tool rounds and context for Groq free tier', () => {
    const groq = resolveAI({ AI_PROVIDER: 'groq' });
    const deepseek = resolveAI({ AI_PROVIDER: 'deepseek' });
    expect(groq.maxToolRounds).toBeLessThanOrEqual(deepseek.maxToolRounds);
    expect(groq.contextMessages).toBeLessThan(deepseek.contextMessages);
    expect(resolveAI({ AI_PROVIDER: 'groq', AI_MAX_TOOL_ROUNDS: '99' }).maxToolRounds).toBe(6);
  });

  it('produces an actionable setup hint naming the exact variable', () => {
    expect(aiSetupHint(resolveAI({ AI_PROVIDER: 'groq' }))).toContain('GROQ_API_KEY');
    expect(aiSetupHint(resolveAI({ AI_PROVIDER: 'ollama' }))).toContain('Ollama');
  });

  it('validates provider ids', () => {
    expect(isAIProviderId('groq')).toBe(true);
    expect(isAIProviderId('nepostoji')).toBe(false);
  });
});
