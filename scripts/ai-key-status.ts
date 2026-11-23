/**
 * Provjera svakog AI ključa uživo: radi li, i ako ne — zašto (kvota, projekat,
 * neispravan ključ). Ne štampa ključ, samo oznaku i status.
 *
 *   npx tsx scripts/ai-key-status.ts
 */
import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const read = (name: string): string | null => {
  const match = new RegExp(`^${name}=(.*)$`, 'm').exec(env);
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
  return value || null;
};

const model = read('AI_MODEL') ?? 'gemini-3.5-flash-lite';
const keys = [read('GEMINI_API_KEY'), read('GEMINI_API_KEY_2'), read('GEMINI_API_KEY_3')];

function mask(key: string | null): string {
  if (!key) return '(nema)';
  return `${key.slice(0, 6)}…${key.slice(-4)} (${key.length} znakova)`;
}

async function probe(key: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'ok' }] }],
      generationConfig: { maxOutputTokens: 8, temperature: 0 },
    }),
  });
  const body = await response.text();
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { status?: string; message?: string } };
    detail = parsed.error ? `${parsed.error.status ?? ''}: ${parsed.error.message ?? ''}` : 'odgovorio je';
  } catch {
    detail = body.slice(0, 120);
  }
  return { status: response.status, ok: response.ok, detail: detail.slice(0, 240), ms: Date.now() - started };
}

async function main() {
  console.log(`Model: ${model}\n`);
  for (const [index, key] of keys.entries()) {
    if (!key) {
      console.log(`ključ ${index + 1}: nije postavljen`);
      continue;
    }
    try {
      const result = await probe(key);
      console.log(`ključ ${index + 1} ${mask(key)} → HTTP ${result.status} | ${result.detail} (${result.ms} ms)`);
    } catch (error) {
      console.log(`ključ ${index + 1} ${mask(key)} → greška mreže: ${(error as Error).message}`);
    }
  }
}

void main();
