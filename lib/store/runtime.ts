import { storageMode } from '@/lib/config/env';
import { FirestoreStore } from './firestoreStore';
import { RtdbStore } from './rtdbStore';
import { getLocalStore } from './localStore';
import type { Store } from './types';

// Runtime store resolver without the `server-only` guard so the standalone
// scraper worker can reuse the exact same persistence implementation.
const globalForStore = globalThis as unknown as {
  __firestoreStore?: FirestoreStore;
  __rtdbStore?: RtdbStore;
};

export function getStore(): Store {
  if (storageMode() === 'rtdb') {
    if (!globalForStore.__rtdbStore) globalForStore.__rtdbStore = new RtdbStore();
    return globalForStore.__rtdbStore;
  }
  if (storageMode() === 'firestore') {
    if (!globalForStore.__firestoreStore) globalForStore.__firestoreStore = new FirestoreStore();
    return globalForStore.__firestoreStore;
  }
  return getLocalStore();
}
