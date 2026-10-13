/* Everything saved on this device: trips (with snapshot images), vehicles, places. */
(function(){
  const DB_NAME = "trip-fuel", VERSION = 2;
  const STORES = ["trips", "vehicles", "places"];
  let dbp = null;

  function open(){
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("no-indexeddb"));
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        STORES.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" }); });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    });
    return dbp;
  }
  function tx(store, mode, fn){
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(r => { out = r; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  function reqP(r){ return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  function table(name){
    return {
      put(rec){ return tx(name, "readwrite", s => reqP(s.put(rec))); },
      putMany(recs){ return tx(name, "readwrite", s => Promise.all(recs.map(r => reqP(s.put(r))))); },
      all(){ return tx(name, "readonly", s => reqP(s.getAll())).then(r => r || []); },
      get(id){ return tx(name, "readonly", s => reqP(s.get(id))); },
      remove(id){ return tx(name, "readwrite", s => reqP(s.delete(id))); },
      clear(){ return tx(name, "readwrite", s => reqP(s.clear())); },
      count(){ return tx(name, "readonly", s => reqP(s.count())).catch(() => 0); }
    };
  }

  const Store = {
    trips: table("trips"),
    vehicles: table("vehicles"),
    places: table("places"),
    newId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
    persist(){ try{ if (navigator.storage && navigator.storage.persist) return navigator.storage.persist(); }catch(e){} return Promise.resolve(false); },

    // Small per-device settings (last used vehicle, region, sort order)
    pref(key, value){
      const k = "trip-fuel:" + key;
      try{
        if (value === undefined) { const v = localStorage.getItem(k); return v === null ? null : JSON.parse(v); }
        localStorage.setItem(k, JSON.stringify(value));
      }catch(e){ return null; }
    },

    // ---- Backup file: everything, images included, as one .json ----
    async backup(){
      const [trips, vehicles, places] = await Promise.all([Store.trips.all(), Store.vehicles.all(), Store.places.all()]);
      const toB64 = blob => new Promise(res => {
        if (!blob) return res(null);
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob);
      });
      const packed = [];
      for (const t of trips){ const c = Object.assign({}, t); c.image = await toB64(t.image); packed.push(c); }
      return { app:"trip-fuel", version:2, exportedAt:new Date().toISOString(), trips:packed, vehicles, places };
    },
    async restore(data, mode){
      if (!data || data.app !== "trip-fuel" || !Array.isArray(data.trips)) throw new Error("not-a-backup");
      const fromB64 = async s => {
        if (!s || typeof s !== "string") return null;
        try{ return await (await fetch(s)).blob(); }catch(e){ return null; }
      };
      if (mode === "replace") await Promise.all([Store.trips.clear(), Store.vehicles.clear(), Store.places.clear()]);
      const existing = mode === "replace" ? new Set() : new Set((await Store.trips.all()).map(t => t.id));
      let added = 0, skipped = 0;
      for (const t of data.trips){
        if (existing.has(t.id)){ skipped++; continue; }
        const c = Object.assign({}, t); c.image = await fromB64(t.image);
        await Store.trips.put(c); added++;
      }
      if (Array.isArray(data.vehicles) && data.vehicles.length) await Store.vehicles.putMany(data.vehicles);
      if (Array.isArray(data.places) && data.places.length) await Store.places.putMany(data.places);
      return { added, skipped };
    }
  };
  window.TripStore = Store;

  // Count badge in the top bar
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("trip-count");
    if (b) Store.trips.count().then(n => { b.textContent = n ? String(n) : ""; });
  });
})();
