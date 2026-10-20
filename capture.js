// CAPTURE — logging a visit in as few moves as possible.
//
// The prompt for this file was her typing "i did grays and torreys since, and hiked aspen
// valley/boreas pass". That is the real interaction: a sentence, two peaks, one ambiguity, no
// dates. Anything that demands more than that will not get used, and an unused log is a wrong
// log — the record quietly rots while looking fine.
//
// FOUR PATTERNS TAKEN FROM PRODUCTS THAT PROVED THEM:
//
//   TWO-TIER LOGGING — Letterboxd separates a one-tap undated "I've seen this" (the eye icon)
//   from a dated diary entry, and its own help calls the undated mark "the best way to
//   back-fill films without having to recall exactly when". Never force someone to remember a
//   date in order to record a fact. markDone() is the eye; logVisit() is the diary.
//
//   BULK GRID — Peakbagger's Quick Ascent Add puts a checkbox and an inline optional date on
//   every row of a list page with one commit button at the top, and the help states outright
//   "You don't even have to add a date." That is why a decade of backlog actually gets entered.
//
//   QUICK ROW ACTION — Untappd's Quick Check-In fires from the search-result row without ever
//   opening the detail page, built explicitly for "backlogging a lot from a recent trip".
//
//   PROPOSE, DON'T ASK — Polarsteps inserts suggestion cards with date and place prefilled
//   that you accept in one tap. parse() below is the text equivalent: it proposes matches and
//   never commits anything on its own.
//
// THE RULE THAT SURVIVES ALL OF IT: this module never invents a coordinate. An unmatched name
// is written with `anchor: "osm:<name>"` and resolved from OpenStreetMap later. A visit with a
// guessed lat/lon is worse than a visit with none, because the map then lies with confidence.

import { INTEREST_KEYS } from "./taxonomy.js?v=14";

const KEY = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

/* ── fuzzy matching ───────────────────────────────────────────────────────
   Deliberately forgiving. Mountain Project's search is literal-match, which is why its own
   forum has a thread titled "search goes from bad to worse" — "Sheeps Nose" returns nothing
   for "Sheep's Nose". Strip punctuation, drop the noise words mountains collect, and score. */
const NOISE = new Set([
  "mount", "mt", "mtn", "mountain", "peak", "the", "of", "pass", "lake", "trail",
  "national", "park", "wilderness", "creek", "basin", "ridge", "loop",
]);

function tokens(s) {
  return KEY(s).replace(/([a-z])([0-9])/g, "$1 $2").split(/\s+/).filter(Boolean);
}
function words(s) {
  return String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !NOISE.has(w));
}

/** 0–1. Exact beats same-significant-words beats prefix beats overlap. */
export function score(query, name) {
  const q = KEY(query), n = KEY(name);
  if (!q || !n) return 0;
  if (q === n) return 1;

  const qw = words(query), nw = words(name);
  // "grays" must resolve to "Grays Peak", not "Grays & Torreys". Both are prefix matches, so
  // prefix scoring alone ties them and the pick comes back ambiguous. Once the noise words are
  // stripped ("peak" is noise), "grays" and "Grays Peak" have an IDENTICAL significant-word
  // set while "Grays & Torreys" has a superset — so set equality is the tie-break that makes a
  // single-word query land on the single thing it names.
  if (qw.length && nw.length && qw.length === nw.length && qw.every(w => nw.includes(w))) return 0.98;

  if (n.startsWith(q) || q.startsWith(n)) return 0.9;
  if (n.includes(q)) return 0.8;
  if (!qw.length || !nw.length) return 0;
  const shared = qw.filter(w => nw.some(x => x === w || x.startsWith(w) || w.startsWith(x)));
  if (!shared.length) return 0;
  return 0.45 + 0.4 * (shared.length / Math.max(qw.length, nw.length));
}

/**
 * Find what she might mean. Returns candidates sorted best-first, never picks one.
 * @param index the places index from places.js
 */
export function search(index, query, { limit = 8, min = 0.45 } = {}) {
  if (!query || query.trim().length < 2) return [];
  const hits = [];
  for (const p of index.places) {
    const s = score(query, p.name);
    if (s >= min) hits.push({ ...p, _score: s, _type: "place" });
  }
  // Places still awaiting an OSM coordinate lookup are searchable too. Deckers and the Dream
  // Stream live here, and omitting them meant a search for something we definitely know about
  // came back "unknown" purely because it had no lat/lon yet.
  for (const p of index.unresolved || []) {
    const s = score(query, p.name);
    if (s >= min) hits.push({ ...p, _score: s, _type: "place", _pending: true });
  }
  for (const r of index.routes) {
    const s = score(query, r.name);
    if (s >= min) hits.push({ ...r, _score: s, _type: "route" });
  }
  return hits
    // Prefer an unvisited match — logging something already logged is usually a mis-hit.
    .sort((a, b) => (b._score - a._score) || (a.visited === b.visited ? 0 : a.visited ? 1 : -1))
    .slice(0, limit);
}

/* ── natural language ─────────────────────────────────────────────────────
   Parses the sentence she actually typed. Splits on conjunctions and slashes, strips leading
   verbs, pulls a date if one is present, and returns one proposal per fragment — each with its
   candidates and an explicit `needsChoice` when the match is not clean.

   It resolves nothing. Everything comes back as a proposal for her to accept, because a
   capture system that silently guesses wrong is how a record becomes untrustworthy. */
const VERBS = /^(?:i\s+)?(?:did|hiked|climbed|summited|summitted|ran|rode|biked|skied|walked|drove|visited|went\s+to|been\s+to|camped\s+at|fished|logged|bagged)\s+/i;
const TRAILING = /\s+(?:since|today|yesterday|last\s+\w+|this\s+\w+|recently|as\s+well|too|also)\b.*$/i;

const MONTHS = ["january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"];

/** Returns the date AND the text it consumed, so the caller can cut it out of the query. */
function extractDate(text) {
  const iso = text.match(/\b(20\d\d)-(\d{1,2})(?:-(\d{1,2}))?\b/);
  if (iso) {
    return { date: `${iso[1]}-${String(iso[2]).padStart(2, "0")}${iso[3] ? "-" + String(iso[3]).padStart(2, "0") : ""}`, matched: iso[0] };
  }
  const mon = text.toLowerCase().match(new RegExp(`\\b(?:in\\s+|on\\s+)?(${MONTHS.join("|")})\\b(?:\\s+(20\\d\\d))?`));
  if (mon) {
    const m = String(MONTHS.indexOf(mon[1]) + 1).padStart(2, "0");
    return { date: `${mon[2] || new Date().getFullYear()}-${m}`, matched: mon[0] };
  }
  return { date: null, matched: null };
}

export function parse(index, text) {
  const { date, matched } = extractDate(text);
  let body = String(text).replace(TRAILING, "").trim();
  // Cut the date out of the searchable text. Left in, "summited quandary in August 2026" gets
  // matched as a whole and the stray words drag it onto Indiana Dunes — a wrong-looking result
  // from a sentence that was perfectly clear.
  // Case-insensitively — the month regex lowercases to match, so `matched` comes back as
  // "in august 2026" while the body still says "in August 2026", and a plain string replace
  // silently does nothing.
  if (matched) {
    body = body.replace(new RegExp(matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ")
      .replace(/\s{2,}/g, " ").trim();
  }

  // "grays and torreys", "aspen valley/boreas pass", "a, b, and c"
  const fragments = body
    .split(/\s*(?:,|\/|\band\b|\+|&|;)\s*/i)
    .map(f => f.replace(VERBS, "").trim())
    .filter(f => f.length >= 2);

  return {
    date,
    proposals: fragments.map(frag => {
      const candidates = search(index, frag, { limit: 5 });
      const best = candidates[0];
      const second = candidates[1];
      // Clean means either a decisive match, or a strong one with nothing else plausible.
      // A significant-word-set equality (0.98) IS decisive on its own — "grays" naming exactly
      // "Grays Peak" needs no runner-up gap to be believed, and requiring one left the obvious
      // case sitting in the ambiguous pile asking a question that answers itself.
      const clean = best && (best._score >= 0.95 ||
        (best._score >= 0.8 && (!second || best._score - second._score >= 0.2)));
      return {
        query: frag,
        candidates,
        pick: clean ? best : null,
        needsChoice: !clean && candidates.length > 0,
        unknown: candidates.length === 0,
      };
    }),
  };
}

/* ── writing ──────────────────────────────────────────────────────────────
   Every function returns a PATCH rather than mutating travel.json, so the caller decides when
   to persist and store.js keeps being the only thing that touches the file. */

/** Tier one: undated. "I have done this." One tap, no date, no ceremony. */
export function markDone(DATA, target) {
  const patch = { fourteeners: null, parksVisited: null, coTowns: null, visits: null };

  if (target._type === "place" || target.kind) {
    const id = target.id || "";

    if (id.startsWith("ft:")) {
      const f14 = (DATA.fourteeners || []).map(f =>
        KEY(f.name) === KEY(target.name) ? { ...f, summited: true, planned: false } : f);
      return { fourteeners: f14 };
    }
    if (id.startsWith("park:") || target.kind === "park") {
      const list = [...new Set([...(DATA.parksVisited || []), target.name])];
      return { parksVisited: list };
    }
    if (id.startsWith("town:")) {
      const towns = (DATA.coTowns || []).map(t =>
        KEY(t.name) === KEY(target.name) ? { ...t, been: true } : t);
      return { coTowns: towns };
    }
  }

  // Everything else lands in the open visit log, which is what makes a pass, a river bend or a
  // brewery loggable without inventing a new list for each.
  const visits = [...(DATA.visits || [])];
  if (!visits.some(v => KEY(v.name) === KEY(target.name))) {
    visits.push({
      name: target.name,
      kind: target.kind || "place",
      region: target.region || null,
      // The discipline: an id we can resolve, or a name OSM can resolve. Never a guess.
      ...(target.id ? { ref: target.id } : { anchor: `osm:${target.name}` }),
      ...(target.lat != null ? { lat: target.lat, lon: target.lon } : {}),
      interests: (target.interests || []).filter(i => INTEREST_KEYS.includes(i)),
      src: "user",
    });
  }
  return { visits };
}

/** Tier two: the dated diary entry. Same fact, more detail, still optional. */
export function logVisit(DATA, target, { date = null, note = "", attempted = false, interests = [] } = {}) {
  const patch = markDone(DATA, target);

  // A turn-back is not a visit to the summit. Peakbagger models three ascent types for exactly
  // this reason, and collapsing them loses the most interesting days.
  if (attempted && (target.id || "").startsWith("ft:")) {
    patch.fourteeners = (DATA.fourteeners || []).map(f =>
      KEY(f.name) === KEY(target.name) ? { ...f, attempted: true, summited: false } : f);
  }

  const visits = [...(patch.visits || DATA.visits || [])];
  const i = visits.findIndex(v => KEY(v.name) === KEY(target.name));
  const entry = {
    name: target.name,
    kind: target.kind || "place",
    region: target.region || null,
    ...(target.id ? { ref: target.id } : { anchor: `osm:${target.name}` }),
    ...(target.lat != null ? { lat: target.lat, lon: target.lon } : {}),
    ...(date ? { date } : {}),
    ...(note ? { note } : {}),
    ...(attempted ? { attempted: true } : {}),
    interests: (interests.length ? interests : target.interests || []).filter(x => INTEREST_KEYS.includes(x)),
    src: "user",
  };
  if (i >= 0) visits[i] = { ...visits[i], ...entry };
  else visits.push(entry);
  patch.visits = visits;
  return patch;
}

/** Peakbagger's bulk commit: many rows, dates only where remembered, one write. */
export function bulkMark(DATA, rows) {
  let working = { ...DATA };
  for (const { target, date } of rows) {
    const patch = date ? logVisit(working, target, { date }) : markDone(working, target);
    working = { ...working, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)) };
  }
  return {
    fourteeners: working.fourteeners,
    parksVisited: working.parksVisited,
    coTowns: working.coTowns,
    visits: working.visits,
  };
}

/** Mark a route done. Nights come from the route, not from a guess. */
export function logRoute(DATA, route, { date = null, note = "", nights = null } = {}) {
  const logged = [...(DATA.routesLogged || [])];
  if (!logged.some(l => l.id === route.id)) {
    logged.push({
      id: route.id, name: route.name,
      ...(date ? { date } : {}),
      ...(note ? { note } : {}),
      nights: nights ?? route.nights ?? null,
      src: "user",
    });
  }
  return { routesLogged: logged };
}

/* ── what to offer next ───────────────────────────────────────────────────
   The suggestion list, ordered by what is actually achievable rather than what is impressive.
   Closest-to-a-milestone first, because that is where the next tick has the most meaning. */
export function suggestNext(DATA, index, progress, { limit = 6 } = {}) {
  const out = [];
  const f14 = DATA.fourteeners || [];

  // A range one summit from complete is the single best thing to point at.
  const range = (progress.state?.ranges || [])
    .filter(r => r.done < r.total && r.done > 0)
    .sort((a, b) => (a.total - a.done) - (b.total - b.done))[0];
  if (range) {
    out.push({ why: `${range.name} is ${range.total - range.done} from complete`,
      targets: range.next, kind: "range" });
  }

  // An unfilled grid cell that has a named candidate is a concrete to-do.
  const cell = (progress.state?.grid?.cells || [])
    .filter(c => !c.filled && c.candidates.length)
    .sort((a, b) => (a.cls * 4 + a.exp) - (b.cls * 4 + b.exp))[0];
  if (cell) {
    out.push({ why: `nothing logged yet at ${cell.label}`, targets: cell.candidates, kind: "grid" });
  }

  // An interest with nothing in it at all.
  const missing = progress.state?.interestsMissing || [];
  if (missing.length) {
    out.push({ why: `nothing logged in ${missing[0]}`, targets: [], kind: "interest" });
  }

  // The nearest suggested park, from her own suggestions list.
  const park = (DATA.suggestions || []).find(s => !(DATA.parksVisited || []).includes(s.park));
  if (park) out.push({ why: park.why, targets: [park.park], kind: "park" });

  // The closest goal milestone.
  for (const [k, g] of Object.entries(progress.goals || {})) {
    if (g.next && g.remaining <= 5) {
      out.push({ why: `${g.remaining} from "${g.next.name}"`, targets: [], kind: k });
    }
  }
  return out.slice(0, limit);
}
