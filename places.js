// PLACES — one index over every data layer, with provenance kept intact.
//
// Five layers arrive in five shapes and have to become one queryable thing:
//
//   parks.js      63 national parks, surveyed coordinates
//   travel.json   her own record: visits, 58 fourteeners with real cls/mi/gain, 144 towns, drives
//   gems.js       curated editorial, NO coordinates by design — anchors into the layers above
//   discovered.js researched editorial, 95 entries, every one with a source URL
//   routes.js     55 multi-day routes with ordered named waypoints
//   osm (later)   live Overpass results
//
// WHY PROVENANCE SURVIVES THE MERGE. A coordinate from the census and a recommendation from a
// blog are both useful and must never be confused. Every place carries `src` and, where a field
// was read between the lines rather than stated, `inferred`. The UI renders those differently.
// Flattening them into one undifferentiated "place" would be the single worst thing this file
// could do, because the result looks authoritative and isn't.
//
// WHY ANCHORS. gems.js holds no lat/lon at all. "Capitol Peak · Knife Edge" anchors to
// `ft:Capitol Peak`, which resolves to the coordinates already in travel.json — coordinates she
// verified. There is no number in the curated layer I could have got wrong from memory, and
// that property is worth the indirection this file exists to unwind.

import { PARKS } from "./parks.js?v=14";
import { GEMS } from "./gems.js?v=14";
import { DISCOVERED } from "./discovered.js?v=14";
import { ROUTES, PERMIT_TIERS } from "./routes.js?v=14";
import { INTEREST_KEYS } from "./taxonomy.js?v=14";
import { STATE } from "./states.js?v=14";

/* ── park name normalisation ──────────────────────────────────────────────
   Sources write "Zion National Park"; parks.js says "Zion". A research pass that returns the
   long form must still resolve, or every card built from it silently loses its park link.
   Handled by rule plus a short table of the ones no rule catches. */
const PARK_ALIAS = {
  "Black Canyon of the Gunnison": "Black Canyon",
  "Great Smoky Mountains": "Great Smoky Mtns",
  "Guadalupe Mountains": "Guadalupe Mtns",
  "Wrangell-St. Elias": "Wrangell-St Elias",
  "Wrangell St. Elias": "Wrangell-St Elias",
  "Haleakalā": "Haleakala",
  "National Park of American Samoa": "American Samoa",
  "Gates of the Arctic": "Gates of the Arctic",
  "Hawaii Volcanoes": "Hawaii Volcanoes",
  "Glen Canyon National Recreation Area": null,      // not one of the 63
  "Gila Cliff Dwellings National Monument": null,
  "Sequoia-Kings Canyon": null,                       // two parks, ambiguous — drop the link
};

const PARK_NAMES = new Set(PARKS.map(p => p.name));

/** "Bryce Canyon National Park" → "Bryce Canyon". Returns null when it is not one of the 63. */
export function canonPark(raw) {
  if (!raw) return null;
  let n = String(raw).trim();
  if (n in PARK_ALIAS) return PARK_ALIAS[n];
  n = n
    .replace(/\s+National Park and Preserve$/i, "")
    .replace(/\s+National Park$/i, "")
    .replace(/\s+National Preserve$/i, "")
    .replace(/\s+National Monument$/i, "")
    .replace(/\s+National Historical Park$/i, "")
    .replace(/\s+National Recreation Area$/i, "")
    .trim();
  if (n in PARK_ALIAS) return PARK_ALIAS[n];
  return PARK_NAMES.has(n) ? n : null;
}

/* ── the index ────────────────────────────────────────────────────────────── */
const KEY = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Build the index. Called once after travel.json loads.
 * @param DATA travel.json
 * @param resolveOSM optional async (name, hintBBox) => [lat, lon] | null, for anchors that
 *        cannot resolve locally. Left injectable so this module stays testable in node.
 */
export function buildPlaces(DATA, { resolveOSM = null } = {}) {
  /* --- coordinate sources she or the census already verified ------------- */
  const byFourteener = new Map();
  for (const f of DATA.fourteeners || []) byFourteener.set(KEY(f.name), f);

  const byPark = new Map();
  for (const p of PARKS) byPark.set(KEY(p.name), p);

  const byTown = new Map();
  for (const t of DATA.coTowns || []) byTown.set(KEY(t.name), t);

  const byCity = new Map();
  for (const c of DATA.cities || []) byCity.set(KEY(c.name), c);

  /**
   * Resolve an anchor string to coordinates, preferring data that was surveyed.
   * "ft:Capitol Peak" → the fourteener's lat/lon from travel.json
   * "park:Zion"       → the park's lat/lon from parks.js
   * "osm:Angels Landing" → deferred; needs the network, returns null here
   * [lat, lon]        → passed straight through, for her own captured pins
   */
  function resolveAnchor(anchor) {
    if (Array.isArray(anchor) && anchor.length === 2) {
      return { lat: anchor[0], lon: anchor[1], precision: "exact", via: "literal" };
    }
    if (typeof anchor !== "string") return null;
    const [kind, ...rest] = anchor.split(":");
    const name = rest.join(":").trim();
    const k = KEY(name);

    if (kind === "ft") {
      const f = byFourteener.get(k);
      if (f) return { lat: f.lat, lon: f.lon, precision: "exact", via: "travel.json fourteeners" };
    }
    if (kind === "park") {
      const p = byPark.get(k);
      if (p) return { lat: p.lat, lon: p.lon, precision: "park centroid", via: "parks.js" };
    }
    if (kind === "town") {
      const t = byTown.get(k);
      if (t) return { lat: t.lat, lon: t.lon, precision: "exact", via: "travel.json coTowns" };
    }
    if (kind === "city") {
      const c = byCity.get(k);
      if (c) return { lat: c.lat, lon: c.lon, precision: "exact", via: "travel.json cities" };
    }
    // Last resort before the network: any layer, by name.
    for (const [map, via, precision] of [
      [byFourteener, "travel.json fourteeners", "exact"],
      [byTown, "travel.json coTowns", "exact"],
      [byCity, "travel.json cities", "exact"],
      [byPark, "parks.js", "park centroid"],
    ]) {
      const hit = map.get(k);
      if (hit) return { lat: hit.lat, lon: hit.lon, precision, via };
    }
    return null;   // caller may hand it to resolveOSM
  }

  /* --- her own coverage, as sets ----------------------------------------- */
  const visitedParks = new Set(DATA.parksVisited || []);
  const visitedStates = new Set(DATA.statesVisited || []);
  const visitedCountries = new Set(DATA.countriesVisited || []);
  const suggested = new Map((DATA.suggestions || []).map(s => [s.park, s.why]));

  /* --- normalise every layer into one shape ------------------------------ */
  const places = [];
  const unresolved = [];

  // 1. the 63 parks — surveyed, and the backbone of the park goal
  for (const p of PARKS) {
    places.push({
      id: `park:${KEY(p.name)}`,
      name: p.name, kind: "park", region: p.state, park: p.name,
      lat: p.lat, lon: p.lon, precision: "park centroid",
      interests: ["trail", "view"],
      cls: null, exposure: null,
      visited: visitedParks.has(p.name),
      suggestedWhy: suggested.get(p.name) || null,
      src: "parks", inferred: [], links: [],
    });
  }

  // 2. the fourteeners — her own verified numbers, so cls/mi/gain come through intact
  for (const f of DATA.fourteeners || []) {
    places.push({
      id: `ft:${KEY(f.name)}`,
      name: f.name, kind: "peak", region: "CO",
      lat: f.lat, lon: f.lon, precision: "exact",
      ft: f.ft, cls: f.cls ?? null, mi: f.mi ?? null, gain: f.gain ?? null,
      drive: f.drive ?? null, ranked: f.ranked !== false,
      interests: f.cls >= 3 ? ["summit", "scramble"] : ["summit"],
      // Exposure derived from class, and flagged as inferred. travel.json records `cls` but not
      // exposure, and without a value here every summited fourteener falls outside the
      // class-by-exposure grid — so the grid reads 0 of 10 filled while she has three summits.
      // Class 1–2 is mild, class 3 serious, class 4+ lethal is the standard Colorado reading,
      // but it IS a derivation, so `inferred` says so and the UI can mark the cell softly.
      exposure: f.cls == null ? null : f.cls <= 2 ? 1 : f.cls === 3 ? 2 : 3,
      visited: !!f.summited, planned: !!f.planned, attempted: !!f.attempted,
      src: "travel.json", inferred: f.cls == null ? [] : ["exposure"], links: [],
    });
  }

  // 3. Colorado towns
  for (const t of DATA.coTowns || []) {
    places.push({
      id: `town:${KEY(t.name)}`,
      name: t.name, kind: "town", region: "CO",
      lat: t.lat, lon: t.lon, precision: "exact",
      interests: ["town"], cls: null, exposure: null,
      visited: !!t.been, subregion: t.region,
      src: "travel.json", inferred: [], links: [],
    });
  }

  // 4. cities she has logged anywhere in the world
  for (const c of DATA.cities || []) {
    places.push({
      id: `city:${KEY(c.name)}`,
      name: c.name, kind: "city", region: null,
      lat: c.lat, lon: c.lon, precision: "exact",
      interests: ["town"], cls: null, exposure: null,
      visited: true,
      src: "travel.json", inferred: [], links: [],
    });
  }

  // 5. curated gems — anchored, never self-positioned
  for (const g of GEMS) {
    const at = resolveAnchor(g.anchor);
    const base = {
      id: g.id, name: g.name, kind: g.kind, region: g.region,
      park: canonPark(g.park), interests: g.interests || [],
      cls: g.cls ?? null, exposure: g.exposure ?? null,
      why: g.why, links: g.links || [], verify: !!g.verify,
      src: "curated", inferred: [], anchor: g.anchor,
      visited: false,
    };
    if (at) places.push({ ...base, lat: at.lat, lon: at.lon, precision: at.precision, via: at.via });
    else unresolved.push(base);
  }

  // 6. researched places
  for (const d of DISCOVERED) {
    const park = canonPark(d.park);
    // Research entries carry no coordinates. Anchor to their park where they have one, and
    // otherwise defer to OSM by name — never guess.
    const at = park ? resolveAnchor(`park:${park}`) : resolveAnchor(`osm:${d.name}`);
    const base = {
      id: `disc:${KEY(d.name)}`,
      name: d.name, kind: d.kind, region: d.region, park,
      interests: d.interests || [],
      cls: d.cls ?? null, exposure: d.exposure ?? null,
      permit: !!d.permit, permitKind: d.permitKind ?? null, season: d.season ?? null,
      why: d.why, links: d.links || [], hidden: !!d.hidden,
      src: "research", inferred: d.inferred || [], batch: d.batch,
      visited: false,
    };
    if (at) places.push({ ...base, lat: at.lat, lon: at.lon, precision: at.precision === "park centroid" ? "park area" : at.precision, via: at.via });
    else unresolved.push({ ...base, anchor: `osm:${d.name}` });
  }

  /* --- routes stay their own collection; a route is not a point ----------- */
  const routes = ROUTES.map(r => ({
    ...r,
    park: canonPark(r.park),
    permitRank: (PERMIT_TIERS[r.permitTier || "none"] || PERMIT_TIERS.none).rank,
    logged: (DATA.routesLogged || []).some(l => l.id === r.id),
    // Waypoints resolve individually; unresolved ones stay named and unplotted rather than
    // being dropped, because the name is still the useful part of a waypoint.
    waypoints: (r.waypoints || []).map(w => {
      const at = resolveAnchor(`osm:${w.name}`);
      return at ? { ...w, lat: at.lat, lon: at.lon, precision: at.precision } : { ...w };
    }),
  }));

  // Her own drives, migrated into the same shape so one renderer handles both.
  for (const [i, rt] of (DATA.routes || []).entries()) {
    routes.push({
      id: `r:own:${i}`, name: rt.name, region: null,
      kind: rt.mode === "rail" ? "rail" : "drive", shape: "point-to-point",
      interests: ["town"], cls: null, exposure: null, nights: null,
      permit: false, permitTier: "none", permitRank: 0, season: null,
      year: rt.year || null,
      waypoints: (rt.pts || []).map(([lat, lon]) => ({ name: "", type: "junction", lat, lon, precision: "exact" })),
      why: "", links: [], hidden: false, inferred: [], src: "travel.json",
      logged: true,            // these are drives she has done
    });
  }

  /* --- dedupe across layers ----------------------------------------------
     The same mountain arrives twice: travel.json calls it "Mt. Sneffels" and the curated layer
     calls it "Mount Sneffels". Both are correct and the list shows them side by side, which
     looks like sloppy data and undermines the provenance claim the whole index rests on.

     Merge by normalised name, keeping the entry with the best provenance as the base — her own
     verified record beats a survey beats editorial — then fold the editorial value (the `why`,
     the source links) onto it. The result is one pin with the good coordinates AND the reason
     anyone should care, which is better than either layer alone. */
  const SRC_RANK = { "travel.json": 4, parks: 3, osm: 2, curated: 1, research: 0 };
  const NOISE_WORDS = /\b(mount|mt|the|via|trail|route|loop)\b/g;
  const dedupeKey = p =>
    KEY(String(p.name).toLowerCase().replace(NOISE_WORDS, " ")) + "|" + (p.region || "");

  const merged = new Map();
  for (const p of places) {
    const k = dedupeKey(p);
    const seen = merged.get(k);
    if (!seen) { merged.set(k, p); continue; }
    const better = (SRC_RANK[p.src] ?? -1) > (SRC_RANK[seen.src] ?? -1) ? p : seen;
    const other = better === p ? seen : p;
    // Keep the better coordinates and identity; inherit the editorial payload.
    better.why = better.why || other.why;
    better.links = (better.links?.length ? better.links : other.links) || [];
    better.interests = [...new Set([...(better.interests || []), ...(other.interests || [])])];
    if (better.cls == null && other.cls != null) {
      better.cls = other.cls;
      better.inferred = [...new Set([...(better.inferred || []), "cls"])];
    }
    if (better.exposure == null && other.exposure != null) better.exposure = other.exposure;
    better.visited = better.visited || other.visited;
    better.mergedFrom = [...(better.mergedFrom || []), other.src];
    merged.set(k, better);
  }
  const deduped = [...merged.values()];
  const dropped = places.length - deduped.length;
  places.length = 0;
  places.push(...deduped);

  /* --- indexes the UI actually asks for ---------------------------------- */
  const byRegion = new Map();
  for (const p of places) {
    if (!p.region) continue;
    if (!byRegion.has(p.region)) byRegion.set(p.region, []);
    byRegion.get(p.region).push(p);
  }
  const routesByRegion = new Map();
  for (const r of routes) {
    if (!r.region) continue;
    if (!routesByRegion.has(r.region)) routesByRegion.set(r.region, []);
    routesByRegion.get(r.region).push(r);
  }

  const index = {
    places, routes, unresolved, byRegion, routesByRegion, dropped,
    visitedParks, visitedStates, visitedCountries, suggested,
    resolveAnchor, canonPark,

    inRegion: code => byRegion.get(code) || [],
    routesIn: code => routesByRegion.get(code) || [],
    byId: id => places.find(p => p.id === id) || routes.find(r => r.id === id) || null,

    /** Resolve whatever is still unplotted, once a network resolver exists. */
    async hydrate(onProgress) {
      if (!resolveOSM) return { resolved: 0, failed: unresolved.length };
      let resolved = 0, failed = 0, n = 0;
      for (const u of [...unresolved]) {
        const at = await resolveOSM(u.name, u.region);
        n++;
        onProgress?.(n, unresolved.length);
        if (at) {
          places.push({ ...u, lat: at[0], lon: at[1], precision: "osm", via: "openstreetmap" });
          const i = unresolved.indexOf(u);
          if (i >= 0) unresolved.splice(i, 1);
          if (u.region) {
            if (!byRegion.has(u.region)) byRegion.set(u.region, []);
            byRegion.get(u.region).push(places[places.length - 1]);
          }
          resolved++;
        } else failed++;
      }
      return { resolved, failed };
    },
  };
  return index;
}

/* ── filtering ────────────────────────────────────────────────────────────
   The question worth answering is never "show me everything". It is "what can I actually do,
   given the time I have, the difficulty I accept and the permits I can still get". */
export function filterPlaces(places, q = {}) {
  const { region, park, interests, maxClass, maxExposure, visited, hidden, needsPermit, src, text } = q;
  const needle = text ? KEY(text) : null;
  return places.filter(p => {
    if (region && p.region !== region) return false;
    if (park && p.park !== park) return false;
    if (visited !== undefined && !!p.visited !== visited) return false;
    if (hidden !== undefined && !!p.hidden !== hidden) return false;
    if (needsPermit !== undefined && !!p.permit !== needsPermit) return false;
    if (src && p.src !== src) return false;
    if (maxClass != null && p.cls != null && p.cls > maxClass) return false;
    if (maxExposure != null && p.exposure != null && p.exposure > maxExposure) return false;
    if (interests?.length && !interests.some(i => (p.interests || []).includes(i))) return false;
    if (needle && !KEY(p.name).includes(needle) && !KEY(p.why || "").includes(needle)) return false;
    return true;
  });
}

/* ── coverage, with the lessons from the gamification research applied ─────
   Three findings drive the shape of this:
     · endowed progress — a fresh profile must never show a row of zeroes, so every goal
       reports its nearest milestone rather than only the distant total
     · intermediate finish lines — the Highpointers Club recognises 25 state highpoints and
       separates 48 Finishers from 50 Completers, because one terminal goal is not enough
     · DEEP over breadth — NomadMania scores regions ÷ countries, because 195 shallow country
       ticks is a less interesting number than how thoroughly you know eight of them */
const MILESTONES = [1, 5, 10, 25, 40, 50];

function milestone(have, total) {
  const rungs = MILESTONES.filter(m => m < total).concat(total);
  const next = rungs.find(m => m > have) ?? total;
  const prev = [...rungs].reverse().find(m => m <= have) ?? 0;
  return { next, prev, toNext: next - have, atMilestone: rungs.includes(have) && have > 0 };
}

export function coverage(DATA, index) {
  const f14 = DATA.fourteeners || [];
  const towns = DATA.coTowns || [];
  const goals = {};

  const add = (key, label, have, total, extra = {}) => {
    goals[key] = { label, have, total, pct: total ? have / total : 0, ...milestone(have, total), ...extra };
  };

  add("parks", "National parks", (DATA.parksVisited || []).length, 63);
  add("states", "States", (DATA.statesVisited || []).length, 51);
  add("countries", "Countries", (DATA.countriesVisited || []).length, 195);
  add("towns", "Colorado towns", towns.filter(t => t.been).length, towns.length);

  // The definitional fork is real and both communities are legitimate: 53 ranked under the
  // 300-ft prominence rule, 58 on the traditional Colorado Mountain Club list. Report both
  // rather than quietly picking a side.
  const summited = f14.filter(x => x.summited);
  add("fourteeners", "Fourteeners", summited.length, f14.length, {
    ranked: { have: summited.filter(x => x.ranked !== false).length, total: f14.filter(x => x.ranked !== false).length },
    note: "53 ranked by prominence · 58 on the traditional list",
  });

  // Peakbagger's three-state model. Without `attempted`, getting weathered off at 13,400 is
  // indistinguishable from never having gone, which is both wrong and demoralising.
  const attempts = {
    summited: summited.length,
    attempted: f14.filter(x => x.attempted && !x.summited).length,
    planned: f14.filter(x => x.planned && !x.summited).length,
  };

  const continents = new Set();
  for (const c of DATA.countriesVisited || []) {
    const cont = index?.continentOf?.(c);
    if (cont) continents.add(cont);
  }

  // DEEP: how thoroughly, not how widely. States per country is the US-weighted version of
  // NomadMania's regions ÷ countries.
  const deep = (DATA.countriesVisited || []).length
    ? ((DATA.statesVisited || []).length + towns.filter(t => t.been).length) / (DATA.countriesVisited || []).length
    : 0;

  return {
    goals, attempts,
    deep: Math.round(deep * 10) / 10,
    routesLogged: (DATA.routesLogged || []).length,
    routesAvailable: index?.routes?.length || 0,
    // Nearest thing to done, so the UI always has something to point at that is close.
    closest: Object.entries(goals)
      .filter(([, g]) => g.total && g.have < g.total)
      .sort((a, b) => a[1].toNext - b[1].toNext)[0]?.[0] || null,
  };
}

/* ── integrity ────────────────────────────────────────────────────────────
   Runs in verify.mjs and in the console at boot. Catches the failure that has bitten this
   project twice: data that silently fails to join, producing a card that looks fine and is
   quietly empty. */
export function auditPlaces(index) {
  const problems = [];
  const vocab = new Set(INTEREST_KEYS);

  for (const p of index.places) {
    if (!p.name) problems.push({ level: "error", msg: `place with no name: ${p.id}` });
    if (p.lat == null || p.lon == null) problems.push({ level: "error", msg: `${p.name} has no coordinates` });
    if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) problems.push({ level: "error", msg: `${p.name} coordinates out of range` });
    for (const i of p.interests || []) if (!vocab.has(i)) problems.push({ level: "error", msg: `${p.name} has unknown interest "${i}"` });
    if (p.src === "research" && !(p.links || []).length) problems.push({ level: "error", msg: `${p.name} is researched but has no source link` });
    if (p.region && p.region.length === 2 && !STATE[p.region]) problems.push({ level: "warn", msg: `${p.name} region "${p.region}" is not a known state code` });
    if ("mi" in p && p.src === "research") problems.push({ level: "error", msg: `${p.name} carries a mileage from research — forbidden` });
  }
  for (const r of index.routes) {
    if (!(r.waypoints || []).length) problems.push({ level: "warn", msg: `route ${r.name} has no waypoints` });
    if (r.src !== "travel.json" && !(r.links || []).length) problems.push({ level: "error", msg: `route ${r.name} has no source link` });
  }
  if (index.unresolved.length) {
    problems.push({ level: "info", msg: `${index.unresolved.length} places await OSM coordinate lookup` });
  }
  return problems;
}
