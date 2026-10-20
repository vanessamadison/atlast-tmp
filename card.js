// The card. Clicking a state opens this; it is the centrepiece of the USA view.
//
// Everything in here is derived from data that already exists — parks.js, travel.json,
// states.js — or computed geometrically at load (which cities fall inside which state, which
// routes crossed it). Nothing is generated to fill space. Where a fact is not recorded, the
// card says it is not recorded and gives her a field to record it.

import { STATE } from "./states.js?v=14";
import { store } from "./store.js?v=14";

const $ = (t, cls, html) => {
  const e = document.createElement(t);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = n => n.toLocaleString("en-US");

let host = null, onClose = null;

export function mountCard(el, closeCb) { host = el; onClose = closeCb; }

export function closeCard() {
  if (!host) return;
  host.classList.remove("open");
  document.body.classList.remove("card-open");
  setTimeout(() => { if (!host.classList.contains("open")) host.innerHTML = ""; }, 220);
  onClose?.();
}

function section(title, kicker) {
  const s = $("div", "csec");
  const h = $("div", "csech");
  h.appendChild($("span", "csect", esc(title)));
  if (kicker) h.appendChild($("span", "cseck", esc(kicker)));
  s.appendChild(h);
  return s;
}

function bar(label, have, total, colour) {
  const w = total ? Math.round((have / total) * 100) : 0;
  const b = $("div", "bar");
  b.innerHTML =
    `<div class="barh"><span>${esc(label)}</span><b>${num(have)}<i>/${num(total)}</i></b></div>` +
    `<div class="bart"><div class="barf" style="width:${w}%;background:${colour}"></div></div>`;
  return b;
}

function chips(items) {
  const w = $("div", "chips");
  for (const it of items) {
    const c = $("span", "chip" + (it.on ? " on" : it.next ? " next" : ""));
    c.innerHTML = esc(it.label) + (it.sub ? `<i>${esc(it.sub)}</i>` : "");
    if (it.title) c.title = it.title;
    w.appendChild(c);
  }
  return w;
}

/* ── the editable block ───────────────────────────────────────────────────
   Priority is 0–5. Saving reports which tier it landed in — see store.js. */
function editable(code, saveStatusEl) {
  const s = section("Priority to visit", "editable · saves to travel.json");
  const cur = store.get(code);

  const row = $("div", "prow");
  const stars = $("div", "stars");
  const paint = v => [...stars.children].forEach((b, i) => b.classList.toggle("on", i < v));
  for (let i = 1; i <= 5; i++) {
    const b = $("button", "star", "&#9670;");
    b.title = ["", "someday", "low", "worth planning", "high", "next up"][i];
    b.addEventListener("click", async () => {
      const next = store.get(code).priority === i ? 0 : i;
      paint(next);
      const tier = await store.set(code, { priority: next });
      flash(saveStatusEl, tier);
    });
    stars.appendChild(b);
  }
  paint(cur.priority || 0);
  row.appendChild(stars);
  row.appendChild($("span", "phint", cur.priority ? "" : "unset"));
  s.appendChild(row);

  const grid = $("div", "fgrid");
  const mk = (key, label, ph) => {
    const wrap = $("label", "field");
    wrap.appendChild($("span", null, esc(label)));
    const inp = $("input");
    inp.type = "text"; inp.placeholder = ph; inp.value = cur[key] || "";
    let t = null;
    inp.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(async () => flash(saveStatusEl, await store.set(code, { [key]: inp.value })), 450);
    });
    wrap.appendChild(inp);
    return wrap;
  };
  grid.appendChild(mk("first", "First visited", "not recorded"));
  grid.appendChild(mk("note", "Note", "why it matters"));
  s.appendChild(grid);
  return s;
}

function flash(el, tier) {
  if (!el) return;
  el.className = "csave " + tier;
  el.textContent = tier === "live" ? "saved to travel.json" : "cached in this browser";
  el.classList.add("show");
  clearTimeout(flash._t);
  flash._t = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ── Street View ──────────────────────────────────────────────────────────
   Google Maps Embed API. Needs her own key; there is no keyless embed. Anchors are real
   coordinates from her data, so a wilderness anchor may legitimately have no panorama. */
function streetview(anchors) {
  const s = section("Street level", "google maps embed");
  if (!anchors.length) { s.appendChild($("p", "cmut", "No coordinates on this card to stand at.")); return s; }

  const key = store.mapsKey();
  const sel = $("select", "sv-sel");
  anchors.forEach((a, i) => {
    const o = document.createElement("option");
    o.value = String(i); o.textContent = a.label;
    sel.appendChild(o);
  });

  const frameWrap = $("div", "sv");
  const render = () => {
    const k = store.mapsKey();
    if (!k) {
      frameWrap.innerHTML = "";
      const p = $("div", "sv-key");
      p.innerHTML =
        `<p>Add a Google Maps API key to walk these places. It is kept in this browser only, never written to the repo.</p>` +
        `<p class="cmut">Enable <b>Maps Embed API</b> in Google Cloud, then restrict the key by HTTP referrer.</p>`;
      const inp = $("input"); inp.type = "password"; inp.placeholder = "paste key";
      const go = $("button", "cbtn", "Save key");
      go.addEventListener("click", () => { store.setMapsKey(inp.value); render(); });
      const r = $("div", "sv-keyrow"); r.appendChild(inp); r.appendChild(go);
      p.appendChild(r);
      frameWrap.appendChild(p);
      return;
    }
    const a = anchors[+sel.value] || anchors[0];
    frameWrap.innerHTML = "";
    const f = document.createElement("iframe");
    f.loading = "lazy"; f.referrerPolicy = "no-referrer-when-downgrade";
    f.allowFullscreen = true;
    f.src = "https://www.google.com/maps/embed/v1/streetview?key=" + encodeURIComponent(k) +
      "&location=" + a.lat + "," + a.lon + "&heading=0&pitch=0&fov=90";
    frameWrap.appendChild(f);
    const foot = $("div", "sv-foot");
    foot.innerHTML = `<span class="cmut">no panorama here means Google has no coverage, not a bug</span>`;
    const clr = $("button", "clink", "change key");
    clr.addEventListener("click", () => { store.setMapsKey(""); render(); });
    foot.appendChild(clr);
    frameWrap.appendChild(foot);
  };
  sel.addEventListener("change", render);
  if (key) s.appendChild(sel);
  s.appendChild(frameWrap);
  render();
  return s;
}

/* ── STATE CARD ───────────────────────────────────────────────────────────── */
export function openState(code, ctx) {
  if (!host) return;
  const meta = STATE[code];
  if (!meta) return;
  const { DATA, PARKS, citiesIn, routesIn, coTownsIn } = ctx;

  const been = new Set(DATA.statesVisited).has(code);
  const visP = new Set(DATA.parksVisited);
  const sug = new Map((DATA.suggestions || []).map(x => [x.park, x.why]));
  const parks = PARKS.filter(p => p.state === code);
  const gotP = parks.filter(p => visP.has(p.name)).length;
  const notes = store.get(code);

  host.innerHTML = "";
  const card = $("div", "card");

  // header
  const head = $("div", "chead" + (been ? " on" : ""));
  head.innerHTML =
    `<div class="ccode">${esc(code)}</div>` +
    `<div class="ctitle"><h2>${esc(meta.name)}</h2>` +
    `<div class="cstat ${been ? "on" : ""}">${been ? "verified in person" : "not yet"}` +
    `<i>${been ? esc(notes.first || "date not recorded") : parks.length ? parks.length + " parks waiting" : "unclaimed"}</i></div></div>`;
  const x = $("button", "x", "&times;");
  x.addEventListener("click", closeCard);
  head.appendChild(x);
  card.appendChild(head);

  const saveStatus = $("div", "csave");
  card.appendChild(saveStatus);

  const body = $("div", "cbody");
  card.appendChild(body);

  // progress
  const prog = $("div", "csec");
  if (parks.length) prog.appendChild(bar("National parks", gotP, parks.length, "var(--a1)"));
  if (code === "CO") {
    const towns = DATA.coTowns || [], f14 = DATA.fourteeners || [];
    prog.appendChild(bar("Colorado towns", towns.filter(t => t.been).length, towns.length, "var(--a2)"));
    prog.appendChild(bar("Fourteeners", f14.filter(f => f.summited).length, f14.length, "var(--white)"));
  }
  if (prog.children.length) body.appendChild(prog);

  // parks
  if (parks.length) {
    const s = section("National parks", `${gotP} of ${parks.length}`);
    s.appendChild(chips(parks.map(p => ({
      label: p.name,
      on: visP.has(p.name),
      next: !visP.has(p.name) && sug.has(p.name),
      sub: visP.has(p.name) ? "been" : sug.has(p.name) ? "suggested" : "",
      title: sug.get(p.name) || "",
    }))));
    body.appendChild(s);
  }

  // landmarks — the invitation
  if (meta.marks?.length) {
    const s = section(been ? "Also here" : "What is waiting", "landmarks");
    s.appendChild(chips(meta.marks.map(m => ({ label: m }))));
    body.appendChild(s);
  }

  // high point / peaks
  const hp = meta.hp;
  const s = section("High point", code === "CO" ? "and the 58" : "");
  const hprow = $("div", "hp");
  hprow.innerHTML = `<b>${esc(hp[0])}</b><span>${num(hp[1])} ft</span>`;
  s.appendChild(hprow);
  if (code === "CO") {
    const f14 = (DATA.fourteeners || []).slice().sort((a, b) => b.ft - a.ft);
    const up = f14.filter(f => f.summited), pl = f14.filter(f => f.planned);
    const line = $("div", "cmut");
    line.textContent =
      `${up.length} summited${up.length ? " — " + up.map(f => f.name).join(", ") : ""}` +
      `${pl.length ? " · planned: " + pl.map(f => f.name).join(", ") : ""}`;
    s.appendChild(line);
    s.appendChild(chips(f14.slice(0, 8).map(f => ({
      label: f.name.replace(/^Mt\. /, ""),
      sub: num(f.ft) + " ft",
      on: f.summited, next: f.planned,
      title: f.cls ? `class ${f.cls} · ${f.mi} mi · ${num(f.gain)} ft gain` : "",
    }))));
  }
  body.appendChild(s);

  // her own logged places
  const cities = citiesIn(code);
  if (cities.length) {
    const cs = section("Cities logged", `${cities.length}`);
    cs.appendChild(chips(cities.map(c => ({ label: c.name, on: true }))));
    body.appendChild(cs);
  }
  if (code === "CO") {
    const t = coTownsIn();
    const ts = section("Towns", `${t.been.length} of ${t.all.length}`);
    ts.appendChild(chips(t.been.slice(0, 24).map(x => ({ label: x.name, on: true }))));
    if (t.been.length > 24) ts.appendChild($("p", "cmut", `+ ${t.been.length - 24} more`));
    body.appendChild(ts);
  }

  // routes that crossed it
  const rts = routesIn(code);
  if (rts.length) {
    const rs = section("Routes through here", `${rts.length}`);
    for (const r of rts) {
      const row = $("div", "route");
      row.innerHTML = `<i class="dot ${r.mode}"></i><b>${esc(r.name)}</b>` +
        `<span>${esc(r.year || "year not recorded")}</span>`;
      rs.appendChild(row);
    }
    body.appendChild(rs);
  } else if (been) {
    const rs = section("Routes through here", "none logged");
    rs.appendChild($("p", "cmut", "You have been, but no route in travel.json passes through. Worth adding one."));
    body.appendChild(rs);
  }

  body.appendChild(editable(code, saveStatus));

  const anchors = [
    ...cities.map(c => ({ label: c.name, lat: c.lat, lon: c.lon })),
    ...parks.map(p => ({ label: p.name + " (park)", lat: p.lat, lon: p.lon })),
    { label: hp[0] + " (high point)", lat: hp[2], lon: hp[3] },
  ];
  body.appendChild(streetview(anchors));

  if (store.mode !== "live") {
    const f = $("div", "cfoot");
    f.appendChild($("span", "cmut", "Edits are cached in this browser. Run serve.sh to write travel.json directly, or"));
    const d = $("button", "clink", "download travel.json");
    d.addEventListener("click", () => store.download());
    f.appendChild(d);
    body.appendChild(f);
  }

  host.appendChild(card);
  host.classList.add("open");
  document.body.classList.add("card-open");
  host.scrollTop = 0;
}

/* ── COUNTRY CARD ─────────────────────────────────────────────────────────── */
export function openCountry(name, ctx) {
  if (!host) return;
  const { DATA, citiesInCountry, continentOf } = ctx;
  const been = new Set(DATA.countriesVisited).has(name);
  const cities = citiesInCountry(name);

  host.innerHTML = "";
  const card = $("div", "card");
  const head = $("div", "chead" + (been ? " on" : ""));
  head.innerHTML =
    `<div class="ccode">${esc((name.match(/\b\w/g) || []).slice(0, 2).join(""))}</div>` +
    `<div class="ctitle"><h2>${esc(name)}</h2>` +
    `<div class="cstat ${been ? "on" : ""}">${been ? "verified in person" : "not yet"}` +
    `<i>${esc(continentOf(name) || "continent not mapped")}</i></div></div>`;
  const x = $("button", "x", "&times;"); x.addEventListener("click", closeCard);
  head.appendChild(x); card.appendChild(head);

  const body = $("div", "cbody"); card.appendChild(body);

  if (cities.length) {
    const s = section("Cities logged", `${cities.length}`);
    s.appendChild(chips(cities.map(c => ({ label: c.name, on: true }))));
    body.appendChild(s);
  } else {
    const s = section("Cities logged", "none");
    s.appendChild($("p", "cmut", been
      ? "Marked visited, but no city in travel.json sits inside this border. Add one and the fill gets brighter."
      : "Nothing logged here yet."));
    body.appendChild(s);
  }

  if (name === "United States") {
    const s = section("Coverage", "");
    s.appendChild(bar("States", DATA.statesVisited.length, 51, "var(--a1)"));
    s.appendChild(bar("National parks", DATA.parksVisited.length, 63, "var(--gold)"));
    body.appendChild(s);
  }

  const g = section("The count", "");
  g.appendChild(bar("Countries", DATA.countriesVisited.length, 195, "var(--a1)"));
  g.appendChild(bar("Continents", ctx.continentCount(), 7, "var(--a2)"));
  body.appendChild(g);

  if (cities.length) {
    body.appendChild(streetview(cities.map(c => ({ label: c.name, lat: c.lat, lon: c.lon }))));
  }

  host.appendChild(card);
  host.classList.add("open");
  document.body.classList.add("card-open");
  host.scrollTop = 0;
}
