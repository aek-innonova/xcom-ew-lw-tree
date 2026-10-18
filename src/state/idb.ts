// The site's IndexedDB: folder handles (the save folder, the game folder) and
// the mod library (state/tools.ts). One database, a store per kind.

const DB_NAME = 'lwtree'
const STORES = ['handles', 'mods'] as const
export type Store = (typeof STORES)[number]

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Version 1 had only "handles"; 2 adds "mods".
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      for (const s of STORES)
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function stored<T>(
  store: Store,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const req = op(d.transaction(store, mode).objectStore(store))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}
