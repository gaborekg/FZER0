// The recordings, kept in IndexedDB — localStorage holds about 5 MB, which is
// a few minutes of audio. Keyed by the session id the recording belongs to.
//
// Stored as bytes + type rather than as a Blob: older Safari could not keep
// Blobs in IndexedDB, and bytes work everywhere.

const DB_NAME = 'fzer0-audio';
const STORE = 'recordings';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        const db = request.result;
        // iOS can close the connection while the app sits in the background —
        // exactly the hour between Before and After. Forget it, so the next
        // call opens a fresh one.
        db.onclose = () => {
          dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

async function run(mode, work, retried = false) {
  const db = await openDb();
  let tx;
  try {
    tx = db.transaction(STORE, mode);
  } catch (error) {
    // A dead connection throws here (WebKit: "Connection to Indexed Database
    // server lost"). Reopen once and try again before giving up.
    dbPromise = null;
    if (retried) throw error;
    return run(mode, work, true);
  }
  return new Promise((resolve, reject) => {
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function putAudio(id, blob) {
  const record = { type: blob.type, data: await blob.arrayBuffer() };
  await run('readwrite', (store) => store.put(record, id));
}

export async function getAudio(id) {
  const record = await run('readonly', (store) => store.get(id));
  return record ? new Blob([record.data], { type: record.type }) : null;
}

export async function deleteAudio(ids) {
  if (ids.length === 0) return;
  await run('readwrite', (store) => {
    ids.forEach((id) => store.delete(id));
  });
}

export async function clearAudio() {
  await run('readwrite', (store) => store.clear());
}

// Asks the browser not to clear this site's storage under pressure. Safari may
// say no; the copy in Files is the safe one either way.
export function askToPersist() {
  navigator.storage?.persist?.().catch(() => {});
}
