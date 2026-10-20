// PANEL — interest filters, search, and the list beside the map.
//
// Two interaction patterns taken from products that proved them:
//
//   onX's facet panel — one "All" chip opens min/max sliders rather than an endless chip row,
//   two taps from map to filters. It is the best filter UI in the category.
//
//   A LIST beside the map, because AllTrails' map view is criticised for exactly its absence:
//   tap a pin, a card appears at the bottom, tap the card to open it — two taps per candidate
//   and no way to compare. A list lets you scan ten places at once, which is what choosing
//   actually requires.
//
// AllTrails' other mistake worth avoiding: strict AND across ten filter categories, which is
// why over-filtering silently empties the list. Interests here are OR within the group and AND
// across groups, and the count is always visible so an empty result is obviously the filter's
// fault rather than looking like missing data.

import { INTERESTS, INTEREST_KEYS, CLASSES } from "./taxonomy.js?v=14";
import { filterPlaces } from "./places.js?v=14";
import { PERMIT_TIERS } from "./routes.js?v=14";

const $ = (t, cls, html) => {
  const e = document.createElement(t);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ── provenance ───────────────────────────────────────────────────────────
   The whole reason places.js keeps `src` and `inferred` through the merge. A surveyed
   coordinate and a blog's recommendation are both useful and must never look identical.
   Every app in the category conflates them; none of them show you which is which. */
const SRC = {
  parks:         { label: "NPS",       tone: "fact",   hint: "official park coordinates" },
  "travel.json": { label: "yours",     tone: "mine",   hint: "your own verified record" },
  curated:       { label: "curated",   tone: "edit",   hint: "editorial — check the source link" },
  research:      { label: "researched", tone: "edit",  hint: "read from public writing — check the link" },
  osm:           { label: "OSM",       tone: "fact",   hint: "OpenStreetMap survey" },
  user:          { label: "logged",    tone: "mine",   hint: "you logged this" },
};

export function provenanceBadge(p) {
  const s = SRC[p.src] || { label: p.src || "?", tone: "edit", hint: "" };
  const b = $("span", `prov ${s.tone}`, esc(s.label));
  const bits = [s.hint];
  if (p.precision) bits.push(`position: ${p.precision}`);
  if (p._pending) bits.push("coordinates not yet resolved");
  if (p.inferred?.length) bits.push(`inferred: ${p.inferred.join(", ")}`);
  b.title = bits.filter(Boolean).join(" · ");
  return b;
}

/* ── difficulty, as two dimensions ────────────────────────────────────────
   AllTrails' four-word label is the single most-criticised feature in the category and its own
   help tells you to read the reviews to understand it. Class and exposure are separate because
   they are separate: Capitol's Knife Edge is class 4 with lethal exposure, and plenty of class
   4 is merely awkward. */
const EXP_DOT = ["", "·", "··", "···"];

export function difficultyChip(p) {
  if (p.cls == null && p.exposure == null) return null;
  const c = $("span", "diffc");
  const parts = [];
  if (p.cls != null) parts.push(`<b>${CLASSES[p.cls]?.short || "c" + p.cls}</b>`);
  if (p.exposure != null) parts.push(`<i class="exp e${p.exposure}">${EXP_DOT[p.exposure] || ""}</i>`);
  c.innerHTML = parts.join("");
  c.title = [
    p.cls != null ? CLASSES[p.cls]?.note : null,
    p.exposure != null ? `exposure: ${["sheltered", "mild", "serious", "lethal"][p.exposure]}` : null,
    p.inferred?.includes("exposure") ? "exposure derived from class, not stated" : null,
  ].filter(Boolean).join(" · ");
  return c;
}

/* ── the panel ────────────────────────────────────────────────────────── */
export function mountPanel(el, opts) {
  const { index, onFilter, onFocus, onLog, suggestions = [] } = opts;

  const state = {
    interests: new Set(),      // empty = all
    text: "",
    region: null,              // set by the view
    show: "all",               // all | todo | done
    maxClass: null,
    maxExposure: null,
    maxPermit: null,
    open: false,
    facets: false,
  };

  el.innerHTML = "";

  /* header: count + a toggle, so the panel can get out of the way */
  const head = $("div", "ph");
  const count = $("div", "phcount", "—");
  const toggle = $("button", "phtog", "Filters");
  head.appendChild(count);
  head.appendChild(toggle);
  el.appendChild(head);

  /* search */
  const searchWrap = $("div", "psearch");
  const search = $("input");
  search.type = "search";
  search.placeholder = "Search places and routes";
  search.autocomplete = "off";
  searchWrap.appendChild(search);
  el.appendChild(searchWrap);

  /* interest chips */
  const chips = $("div", "pchips");
  for (const k of INTEREST_KEYS) {
    const i = INTERESTS[k];
    const c = $("button", "pchip", `<i>${i.icon}</i>${esc(i.label)}`);
    c.title = i.hint;
    c.dataset.k = k;
    c.addEventListener("click", () => {
      state.interests.has(k) ? state.interests.delete(k) : state.interests.add(k);
      c.classList.toggle("on", state.interests.has(k));
      apply();
    });
    chips.appendChild(c);
  }
  el.appendChild(chips);

  /* the facet drawer — onX's pattern: one control opens the sliders */
  const facets = $("div", "pfacets");
  const mkRange = (label, key, max, fmt) => {
    const w = $("label", "pfacet");
    w.appendChild($("span", null, label));
    const r = $("input");
    r.type = "range"; r.min = "0"; r.max = String(max); r.step = "1"; r.value = String(max);
    const out = $("b", null, "any");
    r.addEventListener("input", () => {
      const v = +r.value;
      state[key] = v >= max ? null : v;
      out.textContent = v >= max ? "any" : fmt(v);
      apply();
    });
    w.appendChild(r); w.appendChild(out);
    return w;
  };
  facets.appendChild(mkRange("Max class", "maxClass", 5, v => CLASSES[Math.max(1, v)]?.label || "—"));
  facets.appendChild(mkRange("Max exposure", "maxExposure", 3,
    v => ["sheltered", "mild", "serious", "lethal"][v]));
  facets.appendChild(mkRange("Permit ceiling", "maxPermit", 6,
    v => Object.values(PERMIT_TIERS).find(t => t.rank === v)?.label || "—"));

  const showRow = $("div", "pshow");
  for (const [k, lbl] of [["all", "All"], ["todo", "Not yet"], ["done", "Done"]]) {
    const b = $("button", "pseg" + (k === "all" ? " on" : ""), lbl);
    b.addEventListener("click", () => {
      state.show = k;
      [...showRow.children].forEach(x => x.classList.toggle("on", x === b));
      apply();
    });
    showRow.appendChild(b);
  }
  facets.appendChild(showRow);

  const clear = $("button", "pclear", "Clear all filters");
  clear.addEventListener("click", () => {
    state.interests.clear();
    state.text = ""; search.value = "";
    state.maxClass = state.maxExposure = state.maxPermit = null;
    state.show = "all";
    [...chips.children].forEach(c => c.classList.remove("on"));
    [...facets.querySelectorAll("input[type=range]")].forEach(r => {
      r.value = r.max; r.parentElement.querySelector("b").textContent = "any";
    });
    [...showRow.children].forEach((x, i) => x.classList.toggle("on", i === 0));
    apply();
  });
  facets.appendChild(clear);
  el.appendChild(facets);

  toggle.addEventListener("click", () => {
    state.facets = !state.facets;
    facets.classList.toggle("on", state.facets);
    toggle.classList.toggle("on", state.facets);
  });

  let t = null;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { state.text = search.value.trim(); apply(); }, 160);
  });

  /* What next — the loop, made visible. This is the thing no competitor can do, because
     none of them know what you have already done. */
  if (suggestions.length) {
    const nx = $("div", "pnext");
    nx.appendChild($("div", "pnexth", "What next"));
    for (const s2 of suggestions.slice(0, 4)) {
      const r = $("div", "pnextr");
      r.appendChild($("span", "pnextwhy", esc(s2.why)));
      if (s2.targets?.length) {
        const t2 = $("span", "pnextt", esc(s2.targets.slice(0, 2).join(" · ")));
        r.appendChild(t2);
        r.classList.add("clickable");
        r.addEventListener("click", () => {
          search.value = s2.targets[0];
          state.text = s2.targets[0];
          apply();
        });
      }
      nx.appendChild(r);
    }
    el.appendChild(nx);
  }

  /* results */
  const list = $("div", "plist");
  el.appendChild(list);

  function rowFor(p) {
    const row = $("div", "prow2" + (p.visited ? " done" : ""));

    const main = $("div", "prmain");
    const title = $("div", "prtitle");
    title.appendChild($("span", "prname", esc(p.name)));
    const d = difficultyChip(p);
    if (d) title.appendChild(d);
    main.appendChild(title);

    const meta = $("div", "prmeta");
    meta.appendChild(provenanceBadge(p));
    if (p.ft) meta.appendChild($("span", "prbit", `${p.ft.toLocaleString()} ft`));
    if (p.mi) meta.appendChild($("span", "prbit", `${p.mi} mi`));
    if (p.nights) meta.appendChild($("span", "prbit", `${p.nights}n`));
    if (p.permitTier && p.permitTier !== "none") {
      meta.appendChild($("span", "prbit warn", PERMIT_TIERS[p.permitTier]?.label || "permit"));
    }
    if (p.park) meta.appendChild($("span", "prbit", esc(p.park)));
    if (p._pending) meta.appendChild($("span", "prbit dim", "locating"));
    main.appendChild(meta);

    if (p.why) main.appendChild($("p", "prwhy", esc(p.why)));
    row.appendChild(main);

    const acts = $("div", "practs");
    // One tap, undated. Letterboxd's eye icon — never make someone recall a date to record
    // a fact. The dated entry is a separate, optional action.
    if (!p.visited) {
      const done = $("button", "prdone", "✓");
      done.title = "Mark done — no date needed";
      done.addEventListener("click", e => { e.stopPropagation(); onLog?.(p); });
      acts.appendChild(done);
    }
    row.appendChild(acts);

    row.addEventListener("click", () => onFocus?.(p));
    return row;
  }

  function current() {
    const base = state.region
      ? [...index.inRegion(state.region), ...index.routesIn(state.region)]
      : [...index.places, ...index.routes];

    let out = filterPlaces(base, {
      interests: state.interests.size ? [...state.interests] : undefined,
      text: state.text || undefined,
      maxClass: state.maxClass,
      maxExposure: state.maxExposure,
      visited: state.show === "all" ? undefined : state.show === "done",
    });
    if (state.maxPermit != null) {
      out = out.filter(p => (PERMIT_TIERS[p.permitTier || "none"]?.rank ?? 0) <= state.maxPermit);
    }
    // Unvisited first — the list is for deciding what to do, not admiring what is done.
    return out.sort((a, b) =>
      (a.visited === b.visited ? 0 : a.visited ? 1 : -1) ||
      String(a.name).localeCompare(String(b.name)));
  }

  function apply() {
    const rows = current();
    count.textContent = `${rows.length} place${rows.length === 1 ? "" : "s"}`
      + (state.region ? ` in ${state.region}` : "");
    list.innerHTML = "";
    if (!rows.length) {
      // Say WHY it is empty. AllTrails over-filters silently and the result looks like
      // missing data rather than an over-tight filter.
      const n = state.interests.size + (state.text ? 1 : 0) +
        [state.maxClass, state.maxExposure, state.maxPermit].filter(v => v != null).length;
      list.appendChild($("p", "pempty", n
        ? `Nothing matches those ${n} filter${n === 1 ? "" : "s"}. Loosen one.`
        : "Nothing here yet."));
    } else {
      for (const p of rows.slice(0, 200)) list.appendChild(rowFor(p));
      if (rows.length > 200) list.appendChild($("p", "pempty", `+ ${rows.length - 200} more — narrow the search`));
    }
    onFilter?.(rows);
  }

  return {
    apply,
    setRegion(code) { state.region = code; apply(); },
    rows: current,
    state,
  };
}
