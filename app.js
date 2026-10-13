/* Trip Fuel Cost — calculator page */
(function(){
  "use strict";

  // Fallback prices if prices.json can't be loaded (kept in step with prices.json)
  let P = {
    effective:"2026-10-07", effective_label:"7 October 2026",
    inland:{"93":29.88,"95":30.25,"d50":33.29,"d500":31.95},
    coastal:{"93":29.09,"95":29.38,"d50":32.03,"d500":31.08}
  };
  const GRADES = {"93":"Petrol 93","95":"Petrol 95","d50":"Diesel 50ppm","d500":"Diesel 500ppm"};
  const SHORT  = {"93":"93","95":"95","d50":"D 50","d500":"D 500"};
  const CARS = window.CARS || [];
  const S = window.TripStore;

  const $ = id => document.getElementById(id);
  const state = {
    region: S.pref("region") || "coastal",
    priceCustom: false,
    pts: { from:null, to:null },
    geom: null, duration: null,
    vehicles: [], vehId: null, places: []
  };

  // ---------- helpers ----------
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function num(v,d){ const n = Number(v); return isFinite(n) ? n.toLocaleString("en-ZA",{minimumFractionDigits:d,maximumFractionDigits:d}) : "–"; }
  function money(v){ return Math.round(v).toLocaleString("en-ZA"); }
  function hm(sec){ if (!sec) return ""; const m = Math.round(sec/60), h = Math.floor(m/60); return h ? h + " h " + String(m%60).padStart(2,"0") + " min" : m + " min"; }
  function toast(html, ms){
    document.querySelectorAll(".toast").forEach(t => t.remove());
    const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role","status"); t.innerHTML = html;
    document.body.append(t); setTimeout(() => t.remove(), ms || 5000);
  }
  // Every network call gets a deadline, so a slow service never leaves the page hanging
  function fetchT(url, ms, signal){
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException("timeout","TimeoutError")), ms || 9000);
    if (signal) signal.addEventListener("abort", () => ctl.abort(signal.reason), { once:true });
    return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
  }
  const isAbort = e => e && (e.name === "AbortError" || e.name === "TimeoutError");
  const timedOut = e => e && (e.name === "TimeoutError" || (e.name === "AbortError" && e.message === "timeout"));

  // ---------- offline banner ----------
  function netCheck(){ $("offline").hidden = navigator.onLine !== false; }
  window.addEventListener("online", () => { netCheck(); if (state.pts.from && state.pts.to && !state.geom) route(); });
  window.addEventListener("offline", netCheck);

  // ---------- price board ----------
  function boardPrice(g){ return P[state.region][g]; }
  function grade(){ const v = vehicle(); return (v && v.grade) || "d50"; }
  function renderBoard(){
    const box = $("prices"); box.innerHTML = "";
    Object.keys(GRADES).forEach(g => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "cell" + (g === grade() ? " on" : "");
      b.setAttribute("aria-label", GRADES[g] + " R" + boardPrice(g).toFixed(2) + " per litre, use this fuel");
      b.innerHTML = '<span class="g">' + SHORT[g] + '</span><span class="p">' + boardPrice(g).toFixed(2) + '</span>';
      b.onclick = () => {
        const v = vehicle(); if (!v) return;
        v.grade = g; S.vehicles.put(v);
        state.priceCustom = false; renderBoard(); syncPrice(); renderVehCard(); calc();
      };
      box.append(b);
    });
    $("reg-coastal").setAttribute("aria-pressed", state.region === "coastal");
    $("reg-inland").setAttribute("aria-pressed", state.region === "inland");
    $("board-foot").textContent = "Prices from " + P.effective_label + ". " +
      (state.region === "coastal" ? "Coastal = Cape Town, Durban, Gqeberha and nearby." : "Inland = Gauteng and the interior.") +
      " Diesel varies a little by garage.";
  }
  function syncPrice(){
    if (!state.priceCustom) $("price").value = boardPrice(grade()).toFixed(2);
    $("price-msg").innerHTML = state.priceCustom
      ? 'Using your own price. <button type="button" class="linkish" id="reset-price">Use pump price</button>'
      : GRADES[grade()] + ", " + state.region + " pump price. Type over it if your garage charges something else.";
    const r = $("reset-price"); if (r) r.onclick = () => { state.priceCustom = false; syncPrice(); calc(); };
  }
  function setRegion(r){
    state.region = r; S.pref("region", r);
    const v = vehicle();
    if (v){
      if (v.grade === "93" && r === "coastal") v.grade = "95";
      else if (v.grade === "95" && r === "inland") v.grade = "93";
      S.vehicles.put(v);
    }
    state.priceCustom = false; renderBoard(); syncPrice(); renderVehCard(); calc();
  }
  $("reg-coastal").onclick = () => setRegion("coastal");
  $("reg-inland").onclick = () => setRegion("inland");
  $("price").oninput = () => { state.priceCustom = true; syncPrice(); calc(); };

  // ---------- vehicles ----------
  const NEW = "__new";
  function vehicle(){ return state.vehicles.find(v => v.id === state.vehId) || null; }
  function defaultGrade(fuel){ return fuel === "diesel" ? "d50" : (state.region === "coastal" ? "95" : "93"); }

  function renderVehPicker(){
    const sel = $("veh");
    sel.innerHTML = state.vehicles.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("")
      + `<option value="${NEW}">+ Add a vehicle…</option>`;
    sel.value = state.vehId || NEW;
  }
  function renderVehCard(){
    const v = vehicle(), card = $("vehcard");
    card.hidden = !v;
    if (!v) return;
    const run = v.runCost > 0 ? '<div><span>Running</span><b>R ' + num(v.runCost,2) + '/km</b></div>' : '';
    card.innerHTML =
      '<div class="vehcard-facts">' +
        '<div><span>Fuel use</span><b>' + num(v.l100,1) + ' l/100 km</b></div>' +
        '<div><span>Fuel</span><b>' + esc(GRADES[v.grade] || "") + '</b></div>' + run +
      '</div>' +
      '<button type="button" class="linkish" id="veh-edit">Edit</button>' +
      (v.runCost > 0 ? '' : '<span class="hint">No running cost set — only fuel is counted.</span>');
    $("veh-edit").onclick = () => openVehForm(v);
  }
  $("veh").onchange = () => {
    const val = $("veh").value;
    if (val === NEW){ openVehForm(null); return; }
    state.vehId = val; S.pref("vehId", val);
    state.priceCustom = false;
    closeVehForm(); renderBoard(); syncPrice(); renderVehCard(); calc();
  };

  // --- vehicle form ---
  let editing = null;
  const makes = [...new Set(CARS.map(c => c[0]))].sort();
  $("v-make").innerHTML = '<option value="">Choose…</option>' + makes.map(m => `<option>${esc(m)}</option>`).join("") + '<option value="__other">Not listed</option>';
  function fillVModels(){
    const m = $("v-make").value;
    const list = CARS.filter(c => c[0] === m);
    $("v-model").innerHTML = list.length ? list.map(c => `<option>${esc(c[1])}</option>`).join("") : '<option value="">—</option>';
    $("v-model").disabled = !list.length;
  }
  function applyVModel(){
    const c = CARS.find(c => c[0] === $("v-make").value && c[1] === $("v-model").value);
    if (!c) return;
    $("v-l100").value = c[3];
    $("v-grade").value = defaultGrade(c[2]);
    if (!$("v-run").value) $("v-run").value = c[4];
    if (!$("v-name").value) $("v-name").value = c[0] + " " + c[1];
    checkVehWarn();
  }
  $("v-make").onchange = () => { fillVModels(); applyVModel(); };
  $("v-model").onchange = applyVModel;
  $("v-l100").oninput = checkVehWarn;

  function checkVehWarn(){
    const l = parseFloat($("v-l100").value), w = $("v-warn");
    let msg = "";
    if (l > 0 && l < 3) msg = "That's lower than almost any car manages. Double-check the figure.";
    else if (l > 25) msg = "That's very high for a car or bakkie — check you haven't typed an extra digit.";
    w.hidden = !msg; w.textContent = msg; w.className = "note warn";
  }

  function openVehForm(v){
    editing = v;
    $("vehform").hidden = false;
    $("vehform-title").textContent = v ? "Edit vehicle" : "Add a vehicle";
    $("v-delete").hidden = !v || state.vehicles.length < 2;
    $("v-name").value = v ? v.name : "";
    $("v-make").value = v && v.make ? v.make : "";
    fillVModels();
    if (v && v.model) $("v-model").value = v.model;
    $("v-l100").value = v ? v.l100 : "";
    $("v-grade").value = v ? v.grade : defaultGrade("diesel");
    $("v-run").value = v && v.runCost ? v.runCost : "";
    $("v-warn").hidden = true;
    $("run-helper").open = false;
    $("vehform").scrollIntoView({ behavior:"smooth", block:"nearest" });
    $("v-name").focus();
  }
  function closeVehForm(){ $("vehform").hidden = true; editing = null; $("veh").value = state.vehId || NEW; }
  $("v-cancel").onclick = () => {
    if (!state.vehicles.length){ closeVehForm(); return; }
    closeVehForm();
  };
  $("v-save").onclick = async () => {
    const l100 = parseFloat($("v-l100").value);
    if (!(l100 > 0)){ toast("Fill in the fuel use (l/100 km) first."); $("v-l100").focus(); return; }
    const name = $("v-name").value.trim() || ($("v-make").value && $("v-model").value ? $("v-make").value + " " + $("v-model").value : "My vehicle");
    const v = Object.assign({ id: editing ? editing.id : S.newId(), createdAt: Date.now() }, editing || {}, {
      name, make: $("v-make").value, model: $("v-model").value,
      l100, grade: $("v-grade").value,
      runCost: Math.max(0, parseFloat($("v-run").value) || 0)
    });
    await S.vehicles.put(v);
    state.vehicles = await S.vehicles.all();
    state.vehId = v.id; S.pref("vehId", v.id);
    state.priceCustom = false;
    closeVehForm(); renderVehPicker(); renderBoard(); syncPrice(); renderVehCard(); calc();
    toast(editing ? "Vehicle updated" : "Vehicle saved");
  };
  $("v-delete").onclick = async () => {
    if (!editing) return;
    await S.vehicles.remove(editing.id);
    state.vehicles = await S.vehicles.all();
    state.vehId = state.vehicles.length ? state.vehicles[0].id : null;
    S.pref("vehId", state.vehId);
    closeVehForm(); renderVehPicker(); renderBoard(); syncPrice(); renderVehCard(); calc();
    toast("Vehicle deleted");
  };

  // Running-cost helper
  function runCalc(){
    const n = id => parseFloat($(id).value) || 0;
    let r = 0;
    if (n("hc-serv") && n("hc-servkm")) r += n("hc-serv") / n("hc-servkm");
    if (n("hc-tyre") && n("hc-tyrekm")) r += n("hc-tyre") / n("hc-tyrekm");
    if (n("hc-year") && n("hc-yearkm")) r += n("hc-year") / n("hc-yearkm");
    $("hc-out").innerHTML = r > 0
      ? 'Works out to <b>R ' + num(r,2) + ' per km</b>'
      : "Fill these in and it works out the rand per kilometre.";
    $("hc-use").disabled = !(r > 0);
    return r;
  }
  ["hc-serv","hc-servkm","hc-tyre","hc-tyrekm","hc-year","hc-yearkm"].forEach(id => $(id).addEventListener("input", runCalc));
  $("hc-use").onclick = () => { const r = runCalc(); if (r > 0){ $("v-run").value = Math.round(r*100)/100; $("run-helper").open = false; } };
  runCalc();

  // ---------- saved places ----------
  function renderPlaceChips(){
    const box = $("place-chips");
    const list = state.places.slice().sort((a,b) => (b.uses||0) - (a.uses||0) || (b.lastUsed||0) - (a.lastUsed||0)).slice(0, 8);
    box.hidden = !list.length;
    box.innerHTML = list.length ? '<span class="places-label">Saved places</span>' + list.map(p =>
      '<span class="placechip"><button type="button" data-id="' + esc(p.id) + '" data-k="from">' + esc(p.nickname || p.label.split(",")[0]) + '</button>' +
      '<button type="button" class="to" data-id="' + esc(p.id) + '" data-k="to" aria-label="Use ' + esc(p.nickname || p.label) + ' as the destination">→B</button></span>').join("") : "";
    box.querySelectorAll("button[data-id]").forEach(b => b.onclick = () => {
      const p = state.places.find(x => x.id === b.dataset.id); if (!p) return;
      const k = b.dataset.k;
      state.pts[k] = { lat:p.lat, lon:p.lon, label:p.label };
      $(k).value = p.nickname || p.label;
      p.uses = (p.uses||0) + 1; p.lastUsed = Date.now(); S.places.put(p);
      showFound(k); drawPins(); route(); starState();
    });
  }
  function samePlace(a, b){ return a && b && Math.abs(a.lat-b.lat) < 0.0006 && Math.abs(a.lon-b.lon) < 0.0006; }
  function starState(){
    ["from","to"].forEach(k => {
      const btn = $("star-" + k), p = state.pts[k];
      btn.hidden = !p || p.lat == null;
      if (!p) return;
      const saved = state.places.find(x => samePlace(x, p));
      btn.setAttribute("aria-pressed", !!saved);
      btn.setAttribute("aria-label", saved ? "Remove this saved place" : "Save this place");
      btn.innerHTML = saved
        ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.5l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.9l6.1-.8z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.9l6.1-.8z"/></svg>';
    });
  }
  ["from","to"].forEach(k => $("star-" + k).onclick = async () => {
    const p = state.pts[k]; if (!p || p.lat == null) return;
    const saved = state.places.find(x => samePlace(x, p));
    if (saved){ await S.places.remove(saved.id); toast("Place removed"); }
    else {
      const nickname = ($(k).value.trim() || p.label).split(",")[0].trim().slice(0, 28);
      await S.places.put({ id:S.newId(), label:p.label, lat:p.lat, lon:p.lon, nickname, uses:1, lastUsed:Date.now() });
      toast("Place saved — tap it next time");
    }
    state.places = await S.places.all();
    renderPlaceChips(); starState();
  });

  $("swap").onclick = () => {
    const pf = state.pts.from, pt = state.pts.to, tf = $("from").value;
    state.pts.from = pt; state.pts.to = pf;
    $("from").value = $("to").value; $("to").value = tf;
    showFound("from"); showFound("to"); starState(); drawPins(); route();
  };

  // ---------- map ----------
  let map = null, markers = {}, line = null;
  function initMap(){
    if (!window.L){ $("map").hidden = true; return; }
    map = L.map("map", { zoomControl:true, attributionControl:true, scrollWheelZoom:false }).setView([-30.5, 24.5], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
  }
  function pinIcon(letter){
    return L.divIcon({ className:"", iconSize:[30,30], iconAnchor:[15,15],
      html:'<div style="width:30px;height:30px;border-radius:50%;background:#0c6a3c;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font:700 15px Barlow Condensed,Arial,sans-serif">'+letter+'</div>' });
  }
  function drawPins(){
    if (!map) return;
    ["from","to"].forEach(k => {
      const p = state.pts[k];
      if (markers[k]){ map.removeLayer(markers[k]); markers[k] = null; }
      if (!p || p.lat == null) return;
      const m = L.marker([p.lat, p.lon], { icon: pinIcon(k === "from" ? "A" : "B"), draggable:true, title:"Drag to adjust" }).addTo(map);
      m.on("dragend", async () => {
        const ll = m.getLatLng();
        state.pts[k] = { lat:ll.lat, lon:ll.lng, label:"Pin moved on map" };
        showFound(k, "Looking up the spot…");
        const r = await reverse(ll.lat, ll.lng);
        if (r){ state.pts[k].label = r; $(k).value = r; }
        showFound(k); starState(); route();
      });
      markers[k] = m;
    });
  }
  function fit(){
    if (!map) return;
    const pts = ["from","to"].map(k => state.pts[k]).filter(p => p && p.lat != null).map(p => [p.lat, p.lon]);
    if (line) map.fitBounds(line.getBounds(), { padding:[24,24] });
    else if (pts.length === 2) map.fitBounds(pts, { padding:[24,24] });
    else if (pts.length === 1) map.setView(pts[0], 14);
  }

  // ---------- address search ----------
  const BBOX = "11.5,-35.5,41,-16.5"; // southern Africa
  function labelOf(pr){
    const line1 = [pr.housenumber, pr.street].filter(Boolean).join(" ") || pr.name || "";
    const nameFirst = pr.name && pr.street && pr.name !== pr.street ? pr.name : "";
    const area = [pr.district || pr.locality, pr.city || pr.county, pr.state].filter(Boolean);
    const uniq = [...new Set(area)].filter(a => a !== line1);
    return { a: nameFirst ? nameFirst : line1 || uniq.shift() || "Unnamed place",
             b: (nameFirst ? [line1, ...uniq] : uniq).filter(Boolean).join(", ") };
  }
  async function search(q, signal){
    const near = state.pts.from || { lat:-30.5, lon:24.5 };
    const url = "https://photon.komoot.io/api/?limit=6&lang=en&bbox=" + BBOX +
      "&lat=" + near.lat.toFixed(3) + "&lon=" + near.lon.toFixed(3) + "&q=" + encodeURIComponent(q);
    const r = await fetchT(url, 8000, signal);
    if (!r.ok) throw new Error("search " + r.status);
    const j = await r.json();
    return (j.features || []).map(f => {
      const l = labelOf(f.properties);
      return { lat:f.geometry.coordinates[1], lon:f.geometry.coordinates[0], a:l.a, b:l.b,
        exact: !!f.properties.housenumber, label: l.a + (l.b ? ", " + l.b : "") };
    });
  }
  async function reverse(lat, lon){
    try{
      const r = await fetchT("https://photon.komoot.io/reverse?lang=en&lat=" + lat + "&lon=" + lon, 7000);
      const j = await r.json(); const f = (j.features||[])[0];
      if (!f) return null;
      const l = labelOf(f.properties); return l.a + (l.b ? ", " + l.b : "");
    }catch(e){ return null; }
  }
  function showFound(k, text, warn){
    const box = $("found-" + k);
    box.classList.toggle("warn", !!warn);
    if (text != null){ box.textContent = text; return; }
    const p = state.pts[k];
    box.innerHTML = p && p.lat != null
      ? "Pinned: <b>" + esc(p.label) + "</b>" + (p.approx ? " — street found, not the exact house number. Drag the pin on the map if you need it spot-on." : "")
      : "";
  }

  function setupAddress(k){
    const input = $(k), list = $("sugg-" + k);
    let ctl = null, timer = null, items = [], active = -1;
    function close(){ list.hidden = true; active = -1; input.setAttribute("aria-expanded","false"); }
    function render(){
      list.innerHTML = "";
      if (!items.length){ close(); return; }
      items.forEach((it, i) => {
        const li = document.createElement("li");
        li.setAttribute("role","option"); li.setAttribute("aria-selected", i === active);
        li.innerHTML = '<span class="a">' + esc(it.a) + '</span>' + (it.b ? '<span class="b">' + esc(it.b) + '</span>' : '');
        li.onmousedown = e => e.preventDefault();
        li.onclick = () => pick(it);
        list.append(li);
      });
      list.hidden = false; input.setAttribute("aria-expanded","true");
    }
    function pick(it){
      const typedNumber = (input.value.match(/^\s*(\d+[a-z]?)\s/i) || [])[1];
      state.pts[k] = { lat:it.lat, lon:it.lon, label:it.label, approx: !!typedNumber && !it.exact };
      input.value = it.label; items = []; close();
      showFound(k); starState(); drawPins(); route();
    }
    async function lookup(q){
      if (ctl) ctl.abort(); ctl = new AbortController();
      if (navigator.onLine === false){ showFound(k, "No internet — type the distance in below instead.", true); return; }
      try{
        items = await search(q, ctl.signal); active = -1; render();
        if (!items.length) showFound(k, "No match yet. Try adding the suburb or town.", true);
        else showFound(k, state.pts[k] ? null : "");
      }catch(e){
        if (e.name === "AbortError" && !timedOut(e)) return;
        showFound(k, timedOut(e) ? "Address search is slow right now. Try again, or type the distance in below."
                                 : "Couldn't reach the address search. Check your connection, or type the distance in below.", true);
      }
    }
    input.addEventListener("input", () => {
      state.pts[k] = null; showFound(k, ""); starState(); drawPins(); clearRoute();
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3){ items = []; close(); return; }
      timer = setTimeout(() => lookup(q), 300);
    });
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" && items.length){ active = Math.min(active+1, items.length-1); render(); e.preventDefault(); }
      else if (e.key === "ArrowUp" && items.length){ active = Math.max(active-1, 0); render(); e.preventDefault(); }
      else if (e.key === "Enter"){ e.preventDefault(); if (items.length) pick(items[Math.max(active,0)]); }
      else if (e.key === "Escape") close();
    });
    input.addEventListener("blur", () => setTimeout(close, 150));
    input.addEventListener("focus", () => { if (items.length) render(); });
  }
  setupAddress("from"); setupAddress("to");

  // ---------- GPS ----------
  const gps = $("gps");
  if (!("geolocation" in navigator)) gps.hidden = true;
  gps.onclick = () => {
    gps.disabled = true; showFound("from","Finding where you are…");
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude:lat, longitude:lon } = pos.coords;
      const label = (await reverse(lat, lon)) || "Your current location";
      state.pts.from = { lat, lon, label }; $("from").value = label;
      showFound("from"); starState(); drawPins(); route(); gps.disabled = false;
    }, err => {
      gps.disabled = false;
      showFound("from", err.code === 1
        ? "Location is switched off for this site. Turn it on in Settings → Safari → Location, or type the address."
        : "Couldn't get your location. Type the address instead.", true);
    }, { enableHighAccuracy:true, timeout:15000, maximumAge:60000 });
  };

  // ---------- routing ----------
  let routeCtl = null;
  function clearRoute(){
    if (line && map) map.removeLayer(line);
    line = null; state.geom = null; state.duration = null;
    $("routeinfo").innerHTML = "";
  }
  async function route(){
    clearRoute();
    const a = state.pts.from, b = state.pts.to;
    fit();
    if (!a || !b || a.lat == null || b.lat == null) return;
    const msg = $("route-msg");
    if (navigator.onLine === false){
      msg.hidden = false; msg.className = "note warn";
      msg.textContent = "No internet, so the road distance can't be worked out. Type the distance in below.";
      return;
    }
    if (routeCtl) routeCtl.abort(); routeCtl = new AbortController();
    msg.hidden = false; msg.className = "note"; msg.textContent = "Working out the road route…";
    try{
      const url = "https://router.project-osrm.org/route/v1/driving/" + a.lon + "," + a.lat + ";" + b.lon + "," + b.lat + "?overview=full&geometries=geojson";
      const r = await fetchT(url, 12000, routeCtl.signal);
      const j = await r.json();
      if (j.code !== "Ok" || !j.routes || !j.routes[0]) throw new Error(j.code || "no route");
      const rt = j.routes[0];
      state.geom = rt.geometry.coordinates; state.duration = rt.duration;
      const km = rt.distance / 1000;
      $("km").value = km < 20 ? km.toFixed(1) : Math.round(km);
      $("routeinfo").innerHTML = "Road distance <b>" + num(km, km < 20 ? 1 : 0) + " km</b> · about <b>" + hm(rt.duration) + "</b> driving";
      msg.hidden = true;
      if (map){ line = L.geoJSON(rt.geometry, { style:{ color:"#0c6a3c", weight:5, opacity:.85 } }).addTo(map); fit(); }
      calc();
    }catch(e){
      if (e.name === "AbortError" && !timedOut(e)) return;
      msg.className = "note warn";
      msg.innerHTML = (timedOut(e)
        ? "The route service is slow right now. "
        : "Couldn't work out a road route between those two points. ") +
        '<button type="button" class="linkish" id="retry-route">Try again</button> — or just type the distance in below.';
      const rb = $("retry-route"); if (rb) rb.onclick = route;
    }
  }

  // ---------- the sum ----------
  function current(){
    const km1 = parseFloat($("km").value), price = parseFloat($("price").value), v = vehicle();
    if (!v || !(km1 > 0) || !(price > 0)) return null;
    const km = km1 * ($("ret").checked ? 2 : 1);
    const litres = km * v.l100 / 100 * ($("load").checked ? 1.15 : 1);
    const fuel = litres * price;
    const running = km * (v.runCost || 0);
    return { km1, km, litres, fuel, running, total: fuel + running, v, price };
  }
  function calc(){
    const box = $("result"), c = current();
    if (!c){
      box.innerHTML = '<div class="empty">' + (state.vehicles.length ? "Fill in the trip to see the cost." : "Add a vehicle and a distance to see the cost.") + '</div>';
      markDirty(); return;
    }
    const f = placeShort("from") || "Start", t = placeShort("to") || "Destination";
    const split = c.running > 0
      ? '<div class="split"><div><span>Fuel</span><b>R ' + money(c.fuel) + '</b></div>' +
        '<div><span>Running</span><b>R ' + money(c.running) + '</b></div></div>' : '';
    box.innerHTML =
      '<div class="dest"><span>' + esc(f) + ' ' + ($("ret").checked ? '⇄' : '→') + ' ' + esc(t) + '</span>' +
        '<span class="km">' + num(c.km, c.km < 20 ? 1 : 0) + ' km</span></div>' +
      '<div class="total">R ' + money(c.total) + '<small>' + ($("ret").checked ? 'there &amp; back' : 'one way') +
        (c.running > 0 ? ' · all in' : '') + '</small></div>' + split +
      '<div class="facts">' +
        '<div><span>Fuel needed</span><b>' + num(c.litres,1) + ' l</b></div>' +
        '<div><span>Per km</span><b>R ' + (c.total/c.km).toFixed(2) + '</b></div>' +
        '<div><span>Price used</span><b>R ' + c.price.toFixed(2) + '/l</b></div>' +
      '</div>' +
      '<p class="basis">' + esc(c.v.name) + ' · ' + num(c.v.l100,1) + ' l/100 km · ' + GRADES[c.v.grade] +
        (c.v.runCost > 0 ? ' · R ' + num(c.v.runCost,2) + '/km running' : '') +
        ($("load").checked ? ' · loaded/towing +15%' : '') + '</p>';
    markDirty();
  }
  ["km","ret","load"].forEach(id => $(id).addEventListener("input", () => { kmWarn(); calc(); }));
  function kmWarn(){
    const km = parseFloat($("km").value), msg = $("route-msg");
    if (km > 3000 && !state.geom){ msg.hidden = false; msg.className = "note warn"; msg.textContent = "That's a very long way — check you haven't typed an extra digit."; }
    else if (!state.geom && msg.className.indexOf("warn") >= 0 && msg.textContent.indexOf("extra digit") >= 0) msg.hidden = true;
  }

  // ---------- approve & save ----------
  const ap = { name:$("trip-name"), driver:$("trip-driver"), note:$("trip-note"), btn:$("approve-btn"), line:$("saved-line") };
  let savedSig = null;
  function placeShort(k){ const p = state.pts[k]; return ((p && p.label) || $(k).value || "").split(",")[0].trim(); }
  function defaultName(){
    const f = placeShort("from"), t = placeShort("to");
    return f && t ? f + ($("ret").checked ? " ⇄ " : " → ") + t : "Trip";
  }
  function sig(){
    const c = current();
    return c ? [c.km, c.v.id, c.v.l100, c.v.runCost, c.price, $("ret").checked, $("load").checked, placeShort("from"), placeShort("to")].join("|") : null;
  }
  function markDirty(){
    const c = current();
    ap.name.placeholder = defaultName();
    const done = savedSig && savedSig === sig();
    ap.btn.disabled = !c || done;
    ap.line.hidden = !done;
  }
  [ap.name, ap.driver, ap.note].forEach(i => i.addEventListener("input", () => { savedSig = null; markDirty(); }));

  // ---------- snapshot ----------
  function lonX(lon, z){ return (lon + 180) / 360 * 256 * Math.pow(2, z); }
  function latY(lat, z){ const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 256 * Math.pow(2, z); }
  function loadTile(url){
    return new Promise(res => {
      const img = new Image(); img.crossOrigin = "anonymous";
      const t = setTimeout(() => res(null), 8000);
      img.onload = () => { clearTimeout(t); res(img); };
      img.onerror = () => { clearTimeout(t); res(null); };
      img.src = url;
    });
  }
  async function drawSnapshot(trip, wantTiles){
    const W = 800, H = 450, MH = 360;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    let withTiles = wantTiles;
    g.fillStyle = "#e4ebe6"; g.fillRect(0, 0, W, MH);
    const pts = (trip.geometry && trip.geometry.length > 1) ? trip.geometry
      : [trip.from, trip.to].filter(p => p && p.lat != null).map(p => [p.lat, p.lon]);
    if (pts.length){
      let z = 16;
      for (; z > 2; z--){
        const xs = pts.map(p => lonX(p[1], z)), ys = pts.map(p => latY(p[0], z));
        if (Math.max(...xs) - Math.min(...xs) <= W - 110 && Math.max(...ys) - Math.min(...ys) <= MH - 90) break;
      }
      const xs = pts.map(p => lonX(p[1], z)), ys = pts.map(p => latY(p[0], z));
      const ox = (Math.max(...xs) + Math.min(...xs)) / 2 - W / 2, oy = (Math.max(...ys) + Math.min(...ys)) / 2 - MH / 2;
      if (withTiles){
        const n = Math.pow(2, z), jobs = []; let got = 0;
        for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++)
          for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + MH) / 256); ty++){
            if (ty < 0 || ty >= n) continue;
            const wx = ((tx % n) + n) % n;
            jobs.push(loadTile(`https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`).then(img => { if (img){ got++; g.drawImage(img, tx * 256 - ox, ty * 256 - oy); } }));
          }
        await Promise.all(jobs);
        if (!got) withTiles = false;
        else { g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(0, 0, W, MH); }
      }
      const PT = p => [lonX(p[1], z) - ox, latY(p[0], z) - oy];
      if (pts.length > 1 && trip.geometry){
        g.lineJoin = "round"; g.lineCap = "round";
        [["#ffffff", 10], ["#0c6a3c", 5.5]].forEach(([col, w]) => {
          g.strokeStyle = col; g.lineWidth = w; g.beginPath();
          pts.forEach((p, i) => { const [x, y] = PT(p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
          g.stroke();
        });
      }
      [[trip.from, "A"], [trip.to, "B"]].forEach(([p, l]) => {
        if (!p || p.lat == null) return;
        const [x, y] = PT([p.lat, p.lon]);
        g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.fillStyle = "#0c6a3c"; g.fill();
        g.lineWidth = 3; g.strokeStyle = "#fff"; g.stroke();
        g.fillStyle = "#fff"; g.font = "700 17px 'Barlow Condensed', Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(l, x, y + 1);
      });
      if (withTiles){
        g.font = "500 12px Barlow, Arial, sans-serif"; g.textAlign = "right"; g.textBaseline = "bottom";
        const at = "© OpenStreetMap contributors", tw = g.measureText(at).width;
        g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(W - tw - 14, MH - 22, tw + 14, 22);
        g.fillStyle = "#333"; g.fillText(at, W - 7, MH - 5);
      }
    }
    // Road-sign strip
    g.fillStyle = "#0c6a3c"; g.fillRect(0, MH, W, H - MH);
    g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 2; g.strokeRect(8, MH + 8, W - 16, H - MH - 16);
    g.fillStyle = "#fff"; g.textBaseline = "alphabetic";
    g.textAlign = "right"; g.font = "700 46px 'Barlow Condensed', Arial, sans-serif";
    const costTxt = "R " + money(trip.cost); g.fillText(costTxt, W - 24, MH + 62);
    const cw = g.measureText(costTxt).width;
    g.textAlign = "left"; g.font = "700 26px 'Barlow Condensed', Arial, sans-serif";
    const maxW = W - 48 - cw - 24;
    let title = trip.name.toUpperCase();
    while (g.measureText(title).width > maxW && title.length > 4) title = title.slice(0, -2).trimEnd() + "…";
    g.fillText(title, 24, MH + 44);
    g.font = "500 17px Barlow, Arial, sans-serif"; g.globalAlpha = .9;
    const sub = [num(trip.km, trip.km < 20 ? 1 : 0) + " km", num(trip.litres, 1) + " l", trip.vehicle,
      new Date(trip.savedAt).toLocaleDateString("en-ZA", { day:"numeric", month:"short", year:"numeric" })].filter(Boolean).join("  ·  ");
    let s2 = sub; while (g.measureText(s2).width > maxW && s2.length > 4) s2 = s2.slice(0, -2).trimEnd() + "…";
    g.fillText(s2, 24, MH + 70); g.globalAlpha = 1;
    return await new Promise((res, rej) => { try{ c.toBlob(b => b ? res(b) : rej(new Error("blob")), "image/jpeg", 0.85); }catch(e){ rej(e); } });
  }
  async function snapshot(trip){
    try{ if (document.fonts && document.fonts.ready) await document.fonts.ready; }catch(e){}
    try{ return await drawSnapshot(trip, navigator.onLine !== false); }
    catch(e){ try{ return await drawSnapshot(trip, false); }catch(e2){ return null; } }
  }
  function simplify(coords){
    if (!coords || coords.length < 2) return null;
    const step = Math.max(1, Math.ceil(coords.length / 400)), out = [];
    for (let i = 0; i < coords.length; i += step) out.push([+coords[i][1].toFixed(5), +coords[i][0].toFixed(5)]);
    const last = coords[coords.length - 1]; out.push([+last[1].toFixed(5), +last[0].toFixed(5)]);
    return out;
  }

  ap.btn.onclick = async () => {
    const c = current(); if (!c) return;
    ap.btn.disabled = true; const label = ap.btn.innerHTML; ap.btn.textContent = "Saving…";
    const pick = k => { const p = state.pts[k]; return p && p.lat != null ? { label:p.label, lat:p.lat, lon:p.lon } : { label: $(k).value.trim() }; };
    const trip = {
      id: S.newId(), savedAt: Date.now(),
      name: ap.name.value.trim() || defaultName(),
      vehicle: c.v.name, vehicleId: c.v.id, car: [c.v.make, c.v.model].filter(Boolean).join(" "),
      driver: ap.driver.value.trim(), note: ap.note.value.trim(),
      from: pick("from"), to: pick("to"),
      kmOneWay: c.km1, km: c.km, returnTrip: $("ret").checked, loaded: $("load").checked,
      durationSec: state.duration || null,
      l100: c.v.l100, grade: c.v.grade, gradeLabel: GRADES[c.v.grade], region: state.region,
      price: c.price, priceCustom: state.priceCustom, pricesFrom: P.effective_label,
      litres: c.litres, runCost: c.v.runCost || 0,
      costs: { fuel: c.fuel, running: c.running },
      cost: c.total,
      geometry: simplify(state.geom)
    };
    try{
      trip.image = await snapshot(trip);
      await S.trips.put(trip);
      S.persist();
      savedSig = sig();
      ap.line.innerHTML = '✓ Saved “' + esc(trip.name) + '” · <a href="trips.html">See past trips</a>';
      ap.name.value = ""; ap.note.value = "";
      refreshLists(); markDirty();
      toast('Trip approved and saved · <a href="trips.html">View</a>');
    }catch(e){
      toast("Couldn't save the trip on this device. If you're in Private Browsing, switch it off and try again.", 8000);
      ap.btn.disabled = false;
    }finally{
      ap.btn.innerHTML = label; markDirty();
    }
  };

  function refreshLists(){
    S.trips.all().then(list => {
      const drivers = [...new Set(list.map(t => (t.driver || "").trim()).filter(Boolean))].sort();
      $("drivers-list").innerHTML = drivers.map(d => `<option value="${esc(d)}">`).join("");
      const b = $("trip-count"); if (b) b.textContent = list.length ? String(list.length) : "";
    }).catch(() => {});
  }

  // ---------- start ----------
  (async function start(){
    netCheck();
    initMap();

    try{
      state.vehicles = await S.vehicles.all();
      state.places = await S.places.all();
    }catch(e){
      toast("This browser is blocking saved data, so vehicles and trips can't be kept. Private Browsing is the usual cause.", 9000);
    }

    if (!state.vehicles.length){
      // First run: one example vehicle so the page opens working. Everything is editable.
      const c = CARS.find(c => c[0] === "Toyota" && c[1] === "Hilux 2.8 GD-6");
      const v = { id:S.newId(), createdAt:Date.now(), name:"Hilux", make:c[0], model:c[1], l100:c[3], grade:"d50", runCost:c[4] };
      try{ await S.vehicles.put(v); }catch(e){}
      state.vehicles = [v];
      state.vehId = v.id;
      state.pts = { from:{ lat:-33.9249, lon:18.4241, label:"Cape Town" }, to:{ lat:-33.9628, lon:22.4619, label:"George" } };
      $("from").value = "Cape Town"; $("to").value = "George"; $("km").value = 430;
    } else {
      const want = S.pref("vehId");
      state.vehId = state.vehicles.some(v => v.id === want) ? want : state.vehicles[0].id;
      const last = S.pref("lastTrip");
      if (last){
        state.pts = last.pts || { from:null, to:null };
        $("from").value = last.fromText || ""; $("to").value = last.toText || "";
        $("km").value = last.km || ""; $("ret").checked = !!last.ret; $("load").checked = !!last.load;
      }
    }

    renderVehPicker(); renderBoard(); syncPrice(); renderVehCard();
    renderPlaceChips(); starState();
    showFound("from"); showFound("to"); drawPins();
    calc(); refreshLists();
    if (state.pts.from && state.pts.to) route();

    // Remember the trip in progress for next time
    const remember = () => S.pref("lastTrip", {
      pts: state.pts, fromText: $("from").value, toText: $("to").value,
      km: $("km").value, ret: $("ret").checked, load: $("load").checked
    });
    ["from","to","km","ret","load"].forEach(id => $(id).addEventListener("input", remember));
    window.addEventListener("pagehide", remember);

    // Latest prices
    try{
      const r = await fetchT("prices.json?v=" + Date.now(), 6000);
      const j = await r.json();
      if (j && j.inland && j.coastal){ P = j; renderBoard(); syncPrice(); calc(); }
    }catch(e){}

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  })();
})();
