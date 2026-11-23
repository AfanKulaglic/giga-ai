/**
 * Provera AI ključeva bez pokretanja aplikacije:
 *   npm run ai:check
 * Za svaki ključ pošalje najmanji mogući zahtjev i kaže da li radi.
 */
import { resolveAI } from '@/lib/config/providers';

async function probe(baseUrl: string, model: string, key: string): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
      stream: false,
    }),
  });
  const text = await res.text();
  if (res.ok) return 'OK';
  let detail = text.slice(0, 200);
  try {
    detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? detail;
  } catch {
    /* keep raw text */
  }
  return `${res.status}: ${detail}`;
}

(async () => {
  const ai = resolveAI(process.env as Record<string, string | undefined>);
  console.log(`provajder: ${ai.label} (${ai.provider})`);
  console.log(`model:     ${ai.model}`);
  console.log(`ključeva:  ${ai.apiKeys.length}`);
  console.log(`endpoint:  ${ai.baseUrl}`);
  if (!ai.apiKeys.length) {
    console.log('\nNema ključa. Upišite npr. GEMINI_API_KEY u .env.local.');
    process.exit(1);
  }
  for (const [index, key] of ai.apiKeys.entries()) {
    const label = `${key.slice(0, 6)}…${key.slice(-4)}`;
    const result = await probe(ai.baseUrl, ai.model, key);
    console.log(`ključ ${index + 1} (${label}): ${result}`);
  }
})();
