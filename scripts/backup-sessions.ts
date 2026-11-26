/**
 * Sigurnosna kopija razgovora prije reseta (samo citanje iz RTDB-a).
 * Upotreba: npx tsx scripts/backup-sessions.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = join(process.cwd(), '.env.local');
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]!] = match[2]!.replace(/^"|"$/g, '');
  }
  return out;
}

async function main() {
  const env = loadEnv();
  const credentialPath = (env.FIREBASE_SERVICE_ACCOUNT_PATH ?? '').replace(/^~/, homedir());
  const serviceAccount = JSON.parse(readFileSync(credentialPath, 'utf8'));
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount), databaseURL: env.FIREBASE_DB_URL });
  }
  const db = getDatabase();
  const userId = process.argv[2] ?? 'local-user';
  const nodes = ['giga_sessions', 'giga_messages', 'giga_turns', 'giga_replies'];
  const backup: Record<string, unknown> = {};
  for (const node of nodes) {
    const snapshot = await db.ref(`${node}/${userId}`).get();
    backup[node] = snapshot.val() ?? null;
  }
  mkdirSync('backups', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join('backups', `razgovori-${stamp}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8');
  const sessions = Object.keys(backup.giga_sessions ?? {});
  console.log(`Sačuvano ${sessions.length} razgovora u ${file}`);
}

void main();
