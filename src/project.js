// The project is saved in this browser (IndexedDB), never uploaded. Every call is
// wrapped: a private window or blocked storage just means nothing is remembered.

// The redesign preview (/next/) shares this site's storage with the live app, so it keeps
// its project under its own key.
const DB = "reference-crawler", STORE = "projects", KEY = "redesign";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(data) {
  try {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(data, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch { return false; }
}

export async function loadProject() {
  try {
    const db = await open();
    const data = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return data;
  } catch { return null; }
}
