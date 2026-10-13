/* Trip Fuel Cost — past trips page */
(function(){
  "use strict";
  const $ = id => document.getElementById(id);
  const S = window.TripStore;

  const ICON = {
    truck:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7"/><circle cx="7" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/></svg>',
    user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5"/></svg>',
    note:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5h14M5 10h14M5 15h9"/></svg>',
    trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    share:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M8.5 7.5L12 4l3.5 3.5M5 13v6a1 1 0 001 1h12a1 1 0 001-1v-6"/></svg>',
    img:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    map:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>'
  };

  let trips = [], urls = [], sort = S.pref("sort") || "new", period = S.pref("period") || "all";

  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function num(v,d){ const n = Number(v); return isFinite(n) ? n.toLocaleString("en-ZA",{minimumFractionDigits:d,maximumFractionDigits:d}) : "–"; }
  function money(v){ return Math.round(v || 0).toLocaleString("en-ZA"); }
  function when(ts, withTime){
    const d = new Date(ts);
    return d.toLocaleDateString("en-ZA",{ weekday: withTime ? "short" : undefined, day:"numeric", month:"short", year:"numeric" }) +
      (withTime ? ", " + d.toLocaleTimeString("en-ZA",{ hour:"2-digit", minute:"2-digit" }) : "");
  }
  function hm(sec){ if (!sec) return ""; const m = Math.round(sec/60), h = Math.floor(m/60); return h ? h + " h " + String(m%60).padStart(2,"0") + " min" : m + " min"; }
  function place(p){ return (p && p.label) || "—"; }
  function short(p){ return place(p).split(",")[0].trim(); }
  function url(blob){ if (!blob) return ""; const u = URL.createObjectURL(blob); urls.push(u); return u; }
  function fuelOf(t){ return (t.costs && t.costs.fuel != null) ? t.costs.fuel : (t.cost || 0); }
  function runOf(t){ return (t.costs && t.costs.running) || 0; }
  function toast(html, ms, onAction){
    document.querySelectorAll(".toast").forEach(t => t.remove());
    const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role","status"); t.innerHTML = html;
    const b = t.querySelector("button"); if (b && onAction) b.onclick = () => { t.remove(); onAction(); };
    document.body.append(t); setTimeout(() => t.remove(), ms || 5000);
  }
  function saveFile(blob, filename){
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  }

  // ---------- filtering ----------
  const byText = k => (a, b) => (a[k] || "~").localeCompare(b[k] || "~", "en", { sensitivity:"base" }) || b.savedAt - a.savedAt;
  const SORTS = {
    new: (a,b) => b.savedAt - a.savedAt,
    old: (a,b) => a.savedAt - b.savedAt,
    costhi: (a,b) => b.cost - a.cost,
    costlo: (a,b) => a.cost - b.cost,
    kmhi: (a,b) => b.km - a.km,
    vehicle: byText("vehicle"), driver: byText("driver"), name: byText("name")
  };
  function inPeriod(t){
    if (period === "all") return true;
    const d = new Date(t.savedAt), now = new Date();
    if (period === "year") return d.getFullYear() === now.getFullYear();
    if (period === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
  }
  function visible(){
    const q = $("q").value.trim().toLowerCase(), veh = $("fveh").value;
    let list = trips.filter(inPeriod);
    if (veh) list = list.filter(t => (t.vehicle || "") === veh);
    if (q) list = list.filter(t => [t.name, t.vehicle, t.driver, t.car, t.note, place(t.from), place(t.to)].join(" ").toLowerCase().includes(q));
    return list.sort(SORTS[sort] || SORTS.new);
  }
  function filtered(){ return $("q").value.trim() || $("fveh").value || period !== "all"; }

  // ---------- breakdown ----------
  function renderBreakdown(list){
    const box = $("breakdown");
    if (list.length < 2){ box.hidden = true; return; }
    const groups = {};
    list.forEach(t => {
      const key = $("fveh").value || period !== "all"
        ? new Date(t.savedAt).toLocaleDateString("en-ZA",{ month:"short", year:"numeric" })
        : (t.vehicle || "No vehicle");
      (groups[key] = groups[key] || { km:0, cost:0, n:0 });
      groups[key].km += t.km || 0; groups[key].cost += t.cost || 0; groups[key].n++;
    });
    const rows = Object.entries(groups).sort((a,b) => b[1].cost - a[1].cost).slice(0, 6);
    if (rows.length < 2){ box.hidden = true; return; }
    const max = Math.max(...rows.map(r => r[1].cost));
    box.hidden = false;
    box.innerHTML = '<h2 class="group-h">' + ($("fveh").value || period !== "all" ? "By month" : "By vehicle") + '</h2>' +
      '<div class="bars">' + rows.map(([k, g]) =>
        '<div class="bar"><span class="bl">' + esc(k) + '</span>' +
        '<span class="btrack"><span class="bfill" style="width:' + Math.max(4, g.cost / max * 100) + '%"></span></span>' +
        '<span class="bv">R ' + money(g.cost) + '</span>' +
        '<span class="bn">' + g.n + (g.n === 1 ? " trip" : " trips") + ' · ' + num(g.km,0) + ' km</span></div>').join("") + '</div>';
  }

  // ---------- render ----------
  function render(){
    urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
    document.querySelectorAll("#sorts .chip").forEach(c => c.setAttribute("aria-pressed", c.dataset.sort === sort));
    document.querySelectorAll("#periods .chip").forEach(c => c.setAttribute("aria-pressed", c.dataset.period === period));

    const vehs = [...new Set(trips.map(t => t.vehicle).filter(Boolean))].sort();
    const keep = $("fveh").value;
    $("fveh").innerHTML = '<option value="">All vehicles</option>' + vehs.map(v => `<option${v === keep ? " selected" : ""}>${esc(v)}</option>`).join("");

    const list = visible();
    $("trip-count").textContent = trips.length ? String(trips.length) : "";
    $("s-label").textContent = filtered() ? "Trips shown" : "Trips";
    $("s-count").textContent = list.length;
    $("s-km").textContent = num(list.reduce((s,t) => s + (t.km||0), 0), 0) + " km";
    $("s-cost").textContent = "R " + money(list.reduce((s,t) => s + (t.cost||0), 0));
    $("empty").hidden = trips.length > 0;
    $("tools").hidden = trips.length === 0;
    $("datatools").hidden = false;
    $("clearf").hidden = !filtered();
    $("showing").textContent = trips.length === list.length
      ? trips.length + (trips.length === 1 ? " trip" : " trips")
      : "Showing " + list.length + " of " + trips.length;
    renderBreakdown(list);

    const ul = $("list"); ul.innerHTML = "";
    if (trips.length && !list.length){ ul.innerHTML = '<li class="note">No trips match that.</li>'; return; }
    list.forEach(t => {
      const li = document.createElement("li");
      li.className = "trip"; li.tabIndex = 0; li.setAttribute("role","button");
      li.setAttribute("aria-label", t.name + ", R " + money(t.cost) + ", " + when(t.savedAt));
      const img = url(t.image);
      li.innerHTML =
        '<div class="thumb">' + (img ? '<img src="' + img + '" alt="">' : '') + '</div>' +
        '<div class="trip-body">' +
          '<div class="trip-top"><span class="trip-name">' + esc(t.name) + '</span><span class="trip-cost">R ' + money(t.cost) + '</span></div>' +
          '<div class="trip-route">' + esc(short(t.from)) + (t.returnTrip ? ' ⇄ ' : ' → ') + esc(short(t.to)) + '</div>' +
          '<div class="trip-tags">' +
            (t.vehicle ? '<span class="ttag">' + ICON.truck + esc(t.vehicle) + '</span>' : '') +
            (t.driver ? '<span class="ttag">' + ICON.user + esc(t.driver) + '</span>' : '') +
            (t.note ? '<span class="ttag">' + ICON.note + esc(t.note) + '</span>' : '') +
          '</div>' +
          '<div class="trip-foot"><span><span class="nums">' + num(t.km, t.km < 20 ? 1 : 0) + ' km · ' + num(t.litres,1) + ' l</span> · ' + when(t.savedAt) + '</span>' +
            '<button type="button" class="del" aria-label="Delete ' + esc(t.name) + '">' + ICON.trash + '</button></div>' +
        '</div>';
      li.querySelector(".del").onclick = e => { e.stopPropagation(); removeTrip(t); };
      li.onclick = () => openTrip(t);
      li.onkeydown = e => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); openTrip(t); } };
      ul.append(li);
    });
  }

  async function removeTrip(t){
    try{
      await S.trips.remove(t.id);
      trips = trips.filter(x => x.id !== t.id);
      if ($("sheet").open) $("sheet").close();
      render();
      toast('Deleted “' + esc(t.name) + '” <button type="button">Undo</button>', 8000, async () => {
        await S.trips.put(t); trips.push(t); render();
      });
    }catch(e){ toast("Couldn't delete that trip. Try again."); }
  }

  // ---------- detail ----------
  function openTrip(t){
    const img = url(t.image);
    const gmaps = (t.from && t.from.lat != null && t.to && t.to.lat != null)
      ? "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + t.from.lat + "," + t.from.lon + "&destination=" + t.to.lat + "," + t.to.lon
      : "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + encodeURIComponent(place(t.from)) + "&destination=" + encodeURIComponent(place(t.to));
    const fname = (t.name || "trip").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "trip";
    const canShare = t.image && navigator.canShare && navigator.canShare({ files:[new File([t.image], "x.jpg", { type:"image/jpeg" })] });
    const run = runOf(t);
    $("sheet-in").innerHTML =
      (img ? '<img class="sheet-img" src="' + img + '" alt="Route map for ' + esc(t.name) + '">' : '') +
      '<div class="sheet-body">' +
        '<div class="sheet-title"><div><h2 id="d-name">' + esc(t.name) + '</h2><div class="when">Approved ' + when(t.savedAt, true) + '</div></div>' +
          '<button type="button" class="closex" id="d-close" aria-label="Close">' + ICON.x + '</button></div>' +
        (run > 0 ? '<div class="costbar"><div><span>Fuel</span><b>R ' + money(fuelOf(t)) + '</b></div>' +
          '<div><span>Running</span><b>R ' + money(run) + '</b></div>' +
          '<div class="tot"><span>Total</span><b>R ' + money(t.cost) + '</b></div></div>' : '') +
        '<dl class="dl">' +
          '<div class="wide"><dt>From</dt><dd>' + esc(place(t.from)) + '</dd></div>' +
          '<div class="wide"><dt>To</dt><dd>' + esc(place(t.to)) + '</dd></div>' +
          (run > 0 ? '' : '<div><dt>Fuel cost</dt><dd class="num">R ' + num(t.cost, 2) + '</dd></div>') +
          '<div><dt>Distance</dt><dd class="num">' + num(t.km, t.km < 20 ? 1 : 0) + ' km' + (t.returnTrip ? ' (there &amp; back)' : '') + '</dd></div>' +
          (run > 0 ? '<div><dt>Cost per km</dt><dd class="num">R ' + num(t.cost / t.km, 2) + '</dd></div>' : '') +
          '<div><dt>Vehicle</dt><dd>' + esc(t.vehicle || "—") + '</dd></div>' +
          '<div><dt>Driver</dt><dd>' + esc(t.driver || "—") + '</dd></div>' +
          '<div><dt>Fuel needed</dt><dd class="num">' + num(t.litres, 1) + ' l</dd></div>' +
          '<div><dt>Fuel use</dt><dd class="num">' + num(t.l100, 1) + ' l/100 km</dd></div>' +
          '<div><dt>Fuel</dt><dd>' + esc(t.gradeLabel || "") + ', ' + esc(t.region || "") + '</dd></div>' +
          '<div><dt>Price</dt><dd class="num">R ' + num(t.price, 2) + '/l</dd></div>' +
          (t.durationSec ? '<div class="wide"><dt>Drive time</dt><dd>' + hm(t.durationSec * (t.returnTrip ? 2 : 1)) + '</dd></div>' : '') +
          (t.note ? '<div class="wide"><dt>Note</dt><dd>' + esc(t.note) + '</dd></div>' : '') +
          '<div class="wide"><dt>Based on</dt><dd>' +
            [t.car && t.car !== t.vehicle ? t.car : "", t.loaded ? "Loaded/towing +15%" : "",
             t.runCost ? "R " + num(t.runCost,2) + "/km running cost" : "",
             t.priceCustom ? "Own fuel price" : (t.pricesFrom ? "Pump price of " + t.pricesFrom : "")].filter(Boolean).map(esc).join(" · ") +
          '</dd></div>' +
        '</dl>' +
        '<div class="sheet-actions">' +
          (canShare ? '<button type="button" class="btn quiet" id="d-share">' + ICON.share + 'Share</button>' : '') +
          (img ? '<a class="btn quiet" href="' + img + '" download="' + fname + '.jpg">' + ICON.img + 'Save image</a>' : '') +
          '<a class="btn quiet' + (((canShare ? 1 : 0) + (img ? 1 : 0)) % 2 === 0 ? ' full' : '') + '" href="' + gmaps + '" target="_blank" rel="noopener">' + ICON.map + 'Open in Maps</a>' +
          '<button type="button" class="btn danger full" id="d-del">' + ICON.trash + 'Delete trip</button>' +
        '</div>' +
        '<div class="confirm" id="d-confirm" hidden><p>Delete this trip? The map snapshot goes with it.</p><div>' +
          '<button type="button" class="btn quiet" id="d-no">Keep it</button><button type="button" class="btn danger" id="d-yes">Delete</button></div></div>' +
      '</div>';
    const dlg = $("sheet");
    $("d-close").onclick = () => dlg.close();
    $("d-del").onclick = () => { $("d-confirm").hidden = false; $("d-del").hidden = true; $("d-yes").focus(); };
    $("d-no").onclick = () => { $("d-confirm").hidden = true; $("d-del").hidden = false; };
    $("d-yes").onclick = () => removeTrip(t);
    const sh = $("d-share");
    if (sh) sh.onclick = async () => {
      try{
        await navigator.share({
          files: [new File([t.image], fname + ".jpg", { type:"image/jpeg" })],
          title: t.name,
          text: t.name + " — " + num(t.km, 0) + " km, R " + money(t.cost) + (t.vehicle ? " (" + t.vehicle + ")" : "")
        });
      }catch(e){ if (e && e.name !== "AbortError") toast("Sharing didn't work on this device. Use Save image instead."); }
    };
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open","");
    $("d-close").focus();
  }
  $("sheet").addEventListener("click", e => { if (e.target === $("sheet")) $("sheet").close(); });

  // ---------- data tools ----------
  $("export").onclick = () => {
    const rows = [["Approved","Trip","Vehicle","Driver","From","To","Distance km","There and back","Litres","Fuel use l/100km","Fuel","Region","Price R/l","Fuel cost R","Running cost R","Total R","Note"]];
    visible().forEach(t => rows.push([
      new Date(t.savedAt).toISOString().slice(0,16).replace("T"," "), t.name, t.vehicle, t.driver, place(t.from), place(t.to),
      Math.round(t.km*10)/10, t.returnTrip ? "Yes" : "No", Math.round(t.litres*10)/10, t.l100, t.gradeLabel, t.region, t.price,
      Math.round(fuelOf(t)*100)/100, Math.round(runOf(t)*100)/100, Math.round((t.cost||0)*100)/100, t.note || ""
    ]));
    const csv = rows.map(r => r.map(v => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }).join(",")).join("\r\n");
    saveFile(new Blob(["﻿" + csv], { type:"text/csv" }), "trips-" + new Date().toISOString().slice(0,10) + ".csv");
  };

  $("backup").onclick = async () => {
    const btn = $("backup"); btn.disabled = true;
    try{
      const data = await S.backup();
      const blob = new Blob([JSON.stringify(data)], { type:"application/json" });
      const name = "trip-fuel-backup-" + new Date().toISOString().slice(0,10) + ".json";
      if (navigator.canShare && navigator.canShare({ files:[new File([blob], name, { type:"application/json" })] })){
        try{ await navigator.share({ files:[new File([blob], name, { type:"application/json" })], title:"Trip Fuel backup" }); }
        catch(e){ if (e && e.name !== "AbortError") saveFile(blob, name); }
      } else saveFile(blob, name);
      note("Backed up " + data.trips.length + (data.trips.length === 1 ? " trip" : " trips") + ", " + data.vehicles.length + " vehicle(s) and " + data.places.length + " saved place(s). Keep the file somewhere safe.");
    }catch(e){ note("Couldn't make the backup. Try again.", true); }
    finally{ btn.disabled = false; }
  };
  $("restore").onclick = () => $("restore-file").click();
  $("restore-file").onchange = async e => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    try{
      const data = JSON.parse(await file.text());
      const r = await S.restore(data, "merge");
      trips = await S.trips.all();
      render();
      note("Restored " + r.added + " trip(s)" + (r.skipped ? ", skipped " + r.skipped + " already here" : "") + ".");
      toast("Backup restored");
    }catch(err){ note("That file isn't a Trip Fuel backup, or it's damaged.", true); }
    finally{ e.target.value = ""; }
  };
  function note(text, warn){
    const n = $("backup-note"); n.hidden = false; n.textContent = text;
    n.className = "backup-note" + (warn ? " warn" : "");
  }

  // ---------- wire up ----------
  document.querySelectorAll("#sorts .chip").forEach(c => c.onclick = () => { sort = c.dataset.sort; S.pref("sort", sort); render(); });
  document.querySelectorAll("#periods .chip").forEach(c => c.onclick = () => { period = c.dataset.period; S.pref("period", period); render(); });
  $("q").addEventListener("input", render);
  $("fveh").addEventListener("change", render);
  $("clearf").onclick = () => { $("q").value = ""; $("fveh").value = ""; period = "all"; S.pref("period","all"); render(); };

  S.trips.all().then(list => { trips = list || []; render(); })
    .catch(() => { trips = []; render(); toast("Couldn't open saved trips in this browser. Private Browsing is the usual cause.", 8000); });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
