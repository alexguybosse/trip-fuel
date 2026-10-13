/* Saved trips, kept on this device in IndexedDB (snapshot images included). */
(function(){
  const DB_NAME = "trip-fuel", STORE = "trips", VERSION = 1;
  let dbp = null;

  function open(){
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("no-indexeddb"));
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  function tx(mode, fn){
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(s)).then(r => { out = r; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  function reqP(r){ return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  window.TripStore = {
    put(trip){ return tx("readwrite", s => reqP(s.put(trip))); },
    all(){ return tx("readonly", s => reqP(s.getAll())); },
    get(id){ return tx("readonly", s => reqP(s.get(id))); },
    remove(id){ return tx("readwrite", s => reqP(s.delete(id))); },
    count(){ return tx("readonly", s => reqP(s.count())).catch(() => 0); },
    newId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
    // Ask the browser not to clear saved trips when storage runs low
    persist(){ try{ if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){} }
  };

  // Fill the "Past trips" count badge in the top bar, if there is one
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("trip-count");
    if (b) window.TripStore.count().then(n => { b.textContent = n ? String(n) : ""; });
  });
})();
