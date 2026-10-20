// PROGRESS — coverage, badges and the difficulty grid.
//
// Built from research into what actually works, and deliberately against several things that
// obviously don't. The evidence is first-party and worth keeping in the file, because every
// future instinct to "add more badges" should have to argue with it:
//
//   · On Strava's own community forum: "My profile page tells me I have 632 trophies so... yay?"
//     with replies that "there's too many trophies for it to really be meaningful."
//   · A 1,800-day Duolingo streak holder: it "meant that I spent a large number of days
//     engaging with the platform", and he never knew whether Diamond beat Obsidian.
//   · Pokémon GO produced ~955 extra daily steps in week one and zero by week six.
//   · Untappd's badges were found, across a 2020→2025 ethics review, to reward volume of the
//     underlying behaviour rather than quality of experience.
//
// So: FEW badges, each one EARNED, and every locked badge states what remains. That last part
// is Duolingo's actual good idea — an unearned badge shows the remaining requirement plus a
// completion bar, which makes it a to-do rather than a grey silhouette.
//
// FOUR PATTERNS STOLEN, each from the product that proved it:
//   GRID        Geocaching's 81-cell D/T matrix, where the empty cell IS the to-do list.
//               Applied here to class × exposure, which is the honest difficulty space.
//   PERCENT     Wandrer's percent at every nesting level, and achievements as percent
//               thresholds (25/50/75/90/99/100) rather than medals.
//   AUDIT GLYPH NomadMania's badges certify a fact rather than count an action.
//   ENDOWED     A fresh profile never shows a row of zeroes — the car-wash experiment found
//               a pre-stamped card produced 34% completion versus 19% for identical effort.
//
// NOT BUILT, on purpose: streaks, speed leaderboards, league tiers, and any badge whose
// requirement is "do the thing N times".

import { INTERESTS, INTEREST_KEYS, CLASSES } from "./taxonomy.js?v=14";

/* ── percent thresholds, Wandrer-style ───────────────────────────────────── */
export const THRESHOLDS = [10, 25, 50, 75, 90, 99, 100];

/** Named intermediate finish lines. The Highpointers Club recognises 25 state highpoints and
 *  separates "48 Finishers" from "50 Completers" — one distant total is not enough. */
export const TIERS = {
  parks: [
    { at: 1, name: "First park" },
    { at: 5, name: "Five" },
    { at: 10, name: "Double figures" },
    { at: 25, name: "Quarter century" },
    { at: 40, name: "Two thirds" },
    { at: 63, name: "All sixty-three" },
  ],
  fourteeners: [
    { at: 1, name: "First fourteener" },
    { at: 5, name: "Five" },
    { at: 14, name: "Fourteen of them" },
    { at: 28, name: "Halfway" },
    { at: 53, name: "The ranked fifty-three" },
    { at: 58, name: "The full fifty-eight" },
  ],
  states: [
    { at: 5, name: "Five states" },
    { at: 16, name: "Under a third" },
    { at: 25, name: "Halfway" },
    { at: 48, name: "The lower forty-eight" },
    { at: 51, name: "Every one" },
  ],
  countries: [
    { at: 5, name: "Five countries" },
    { at: 10, name: "Double figures" },
    { at: 25, name: "Twenty-five" },
    { at: 50, name: "Fifty" },
    { at: 100, name: "The century" },
    { at: 195, name: "All of it" },
  ],
  towns: [
    { at: 10, name: "Ten towns" },
    { at: 36, name: "A quarter of Colorado" },
    { at: 72, name: "Half of Colorado" },
    { at: 108, name: "Three quarters" },
    { at: 144, name: "Every town" },
  ],
  continents: [
    { at: 1, name: "Off the block" },
    { at: 4, name: "Four continents" },
    { at: 6, name: "Six" },
    { at: 7, name: "All seven" },
  ],
};

/**
 * Progress on one goal, shaped so nothing ever renders as a bare zero.
 * `next` always exists until the goal is finished, and `remaining` is phrased as a to-do.
 */
export function goalProgress(key, have, total) {
  const tiers = TIERS[key] || [{ at: total, name: "Complete" }];
  const earned = tiers.filter(t => have >= t.at);
  const next = tiers.find(t => have < t.at) || null;
  const pct = total ? (have / total) * 100 : 0;
  return {
    key, have, total, pct,
    tier: earned.length ? earned[earned.length - 1] : null,
    next,
    remaining: next ? next.at - have : 0,
    // Progress within the current tier, so the bar is always meaningfully full rather than
    // showing 1/195 and looking like nothing has happened.
    tierPct: next
      ? ((have - (earned.length ? earned[earned.length - 1].at : 0)) /
         (next.at - (earned.length ? earned[earned.length - 1].at : 0))) * 100
      : 100,
    threshold: THRESHOLDS.filter(t => pct >= t).pop() || 0,
    done: total > 0 && have >= total,
  };
}

/* ── the difficulty grid ──────────────────────────────────────────────────
   Geocaching's D/T matrix is the best long-term completion object anyone has built: a grid
   where shading a cell requires finding a cache of that exact difficulty and terrain, so the
   EMPTY CELL IS THE TO-DO LIST. The equivalent axes here are YDS class and exposure, which is
   also the honest way to describe a mountain — Capitol's Knife Edge is class 4 with lethal
   exposure while plenty of class 4 is merely awkward, and one number cannot say both. */
export function difficultyGrid(places) {
  const cells = [];
  for (let cls = 1; cls <= 5; cls++) {
    for (let exp = 0; exp <= 3; exp++) {
      const inCell = places.filter(p => p.cls === cls && p.exposure === exp);
      const done = inCell.filter(p => p.visited);
      cells.push({
        cls, exp,
        label: `${CLASSES[cls].label} · ${["sheltered", "mild", "serious", "lethal"][exp]}`,
        total: inCell.length,
        done: done.length,
        filled: done.length > 0,
        // What to do to fill this cell. An empty cell that cannot name a candidate is not a
        // to-do, it is just a hole, so those render as unavailable rather than incomplete.
        candidates: inCell.filter(p => !p.visited).slice(0, 3).map(p => p.name),
      });
    }
  }
  const available = cells.filter(c => c.total > 0);
  return {
    cells,
    filled: available.filter(c => c.filled).length,
    available: available.length,
    hardestFilled: available.filter(c => c.filled).sort((a, b) => (b.cls * 4 + b.exp) - (a.cls * 4 + a.exp))[0] || null,
  };
}

/* ── range completion ─────────────────────────────────────────────────────
   travel.json already groups the fourteeners. Range-by-range is a better unit than the bare
   58, because a range is a trip and the whole list is a decade. */
export function rangeProgress(fourteeners) {
  const groups = new Map();
  for (const f of fourteeners) {
    const g = f.group || "Other";
    if (!groups.has(g)) groups.set(g, { name: g, total: 0, done: 0, next: [] });
    const e = groups.get(g);
    e.total++;
    if (f.summited) e.done++;
    else if (e.next.length < 3) e.next.push(f.name);
  }
  return [...groups.values()]
    .map(g => ({ ...g, pct: (g.done / g.total) * 100 }))
    .sort((a, b) => b.pct - a.pct || b.total - a.total);
}

/* ── badges ───────────────────────────────────────────────────────────────
   Each badge is a fact about the record, not a count of actions. Every one carries `remaining`
   so a locked badge tells you what to do — the single thing Duolingo's achievement screen gets
   right that Strava's 632-trophy case gets wrong.

   `check` receives the full state and returns { earned, have, need, remaining }. */
export const BADGES = [
  {
    id: "first-blood", name: "Ground Truth", icon: "◆",
    blurb: "Log your first verified visit.",
    check: s => ({ earned: s.totalVisited >= 1, have: s.totalVisited, need: 1 }),
  },
  {
    id: "class-three", name: "Hands On Rock", icon: "⋀",
    blurb: "Summit something at class 3 or harder — where a fall starts to matter.",
    check: s => ({ earned: s.maxClassDone >= 3, have: s.maxClassDone, need: 3,
      remaining: s.nextClassCandidate ? `try ${s.nextClassCandidate}` : null }),
  },
  {
    id: "class-four", name: "Exposed", icon: "⋔",
    blurb: "Summit something at class 4. Sustained exposure, and a fall is likely fatal.",
    check: s => ({ earned: s.maxClassDone >= 4, have: s.maxClassDone, need: 4 }),
  },
  {
    id: "grid-quarter", name: "Grid Quarter", icon: "▦",
    blurb: "Fill a quarter of the class-and-exposure grid.",
    check: s => ({ earned: s.grid.filled >= Math.ceil(s.grid.available / 4),
      have: s.grid.filled, need: Math.ceil(s.grid.available / 4) }),
  },
  {
    id: "one-range", name: "Range Complete", icon: "▲",
    blurb: "Finish every fourteener in a single range.",
    check: s => {
      const done = s.ranges.filter(r => r.done === r.total && r.total > 1);
      const closest = s.ranges.filter(r => r.done < r.total && r.total > 1)
        .sort((a, b) => (a.total - a.done) - (b.total - b.done))[0];
      return { earned: done.length >= 1, have: done.length, need: 1,
        remaining: closest ? `${closest.name} is closest — ${closest.total - closest.done} left` : null };
    },
  },
  {
    id: "breadth", name: "Generalist", icon: "✦",
    blurb: "Log something in eight different interests — not just summits.",
    check: s => ({ earned: s.interestsCovered.length >= 8, have: s.interestsCovered.length, need: 8,
      remaining: s.interestsMissing.length ? `nothing logged yet in ${s.interestsMissing.slice(0, 3).join(", ")}` : null }),
  },
  {
    id: "deep", name: "Depth Over Breadth", icon: "◉",
    blurb: "A DEEP score above 10 — knowing places thoroughly beats collecting passport stamps.",
    check: s => ({ earned: s.deep >= 10, have: s.deep, need: 10 }),
  },
  {
    id: "route-logged", name: "Multi-Day", icon: "⋯",
    blurb: "Log a route that took more than one day.",
    check: s => ({ earned: s.multiDayLogged >= 1, have: s.multiDayLogged, need: 1 }),
  },
  {
    id: "shoulder", name: "Off Season", icon: "❋",
    blurb: "Log a visit outside the obvious summer window.",
    check: s => ({ earned: s.offSeasonVisits >= 1, have: s.offSeasonVisits, need: 1 }),
  },
  {
    id: "turned-back", name: "Good Judgement", icon: "↩",
    blurb: "Record a turn-back. Deciding not to summit is a real outcome and worth keeping.",
    // Deliberately earned by logging a FAILURE. Peakbagger records turn-backs as a first-class
    // ascent type, and a system that only rewards success teaches people to hide the days they
    // made the right call.
    check: s => ({ earned: s.attempted >= 1, have: s.attempted, need: 1 }),
  },
  {
    id: "home-range", name: "Home Ground", icon: "▣",
    blurb: "Half the towns in your home state.",
    check: s => ({ earned: s.townsPct >= 50, have: Math.round(s.townsPct), need: 50 }),
  },
  {
    id: "verified-all", name: "Every One Verified", icon: "✓",
    // An audit glyph in NomadMania's sense: it certifies a property of the record rather than
    // counting activity. Earned by having no visit missing a date or a source.
    blurb: "Every logged visit carries a date. A record you can actually trust.",
    check: s => ({ earned: s.undatedVisits === 0 && s.totalVisited > 0, have: s.totalVisited - s.undatedVisits,
      need: s.totalVisited, remaining: s.undatedVisits ? `${s.undatedVisits} visits have no date` : null }),
  },
];

/** Roll the whole record into the shape BADGES expect, then evaluate them. */
export function evaluate(DATA, index) {
  const f14 = DATA.fourteeners || [];
  const towns = DATA.coTowns || [];
  const visits = DATA.visits || [];
  const places = index?.places || [];

  const summited = f14.filter(f => f.summited);
  const grid = difficultyGrid(places);
  const ranges = rangeProgress(f14);

  const interestsCovered = [...new Set(
    places.filter(p => p.visited).flatMap(p => p.interests || [])
      .concat(visits.flatMap(v => v.interests || []))
  )];
  const interestsMissing = INTEREST_KEYS
    .filter(k => !interestsCovered.includes(k))
    .map(k => INTERESTS[k].label.toLowerCase());

  const totalVisited =
    (DATA.parksVisited || []).length + summited.length +
    towns.filter(t => t.been).length + (DATA.cities || []).length + visits.length;

  const deep = (DATA.countriesVisited || []).length
    ? ((DATA.statesVisited || []).length + towns.filter(t => t.been).length) /
      (DATA.countriesVisited || []).length
    : 0;

  const nextClass = f14.filter(f => !f.summited && f.cls >= 3).sort((a, b) => a.cls - b.cls)[0];

  const state = {
    totalVisited,
    maxClassDone: Math.max(0, ...summited.map(f => f.cls || 0)),
    nextClassCandidate: nextClass ? nextClass.name : null,
    grid, ranges,
    interestsCovered, interestsMissing,
    deep: Math.round(deep * 10) / 10,
    attempted: f14.filter(f => f.attempted).length + visits.filter(v => v.attempted).length,
    townsPct: towns.length ? (towns.filter(t => t.been).length / towns.length) * 100 : 0,
    multiDayLogged: (DATA.routesLogged || []).filter(l => (l.nights || 0) >= 1).length,
    offSeasonVisits: visits.filter(v => {
      const m = +(String(v.date || "").split("-")[1] || 0);
      return m && (m <= 4 || m >= 10);
    }).length,
    undatedVisits: visits.filter(v => !v.date).length,
  };

  const badges = BADGES.map(b => {
    const r = b.check(state) || {};
    return {
      ...b, earned: !!r.earned, have: r.have ?? 0, need: r.need ?? 1,
      // The locked-badge treatment: a bar plus the words for what is left.
      pct: r.need ? Math.min(100, ((r.have ?? 0) / r.need) * 100) : 0,
      // Round, or a DEEP score of 8.8 against a target of 10 renders as
      // "1.1999999999999993 to go", which is both wrong-looking and unreadable.
      remaining: r.earned ? null
        : (r.remaining || `${Math.round(Math.max(0, (r.need ?? 1) - (r.have ?? 0)) * 10) / 10} to go`),
    };
  });

  return {
    state, badges,
    earned: badges.filter(b => b.earned),
    // Closest locked badge first, so there is always one obvious next thing.
    nextUp: badges.filter(b => !b.earned).sort((a, b) => b.pct - a.pct).slice(0, 3),
    goals: {
      parks: goalProgress("parks", (DATA.parksVisited || []).length, 63),
      fourteeners: goalProgress("fourteeners", summited.length, f14.length || 58),
      states: goalProgress("states", (DATA.statesVisited || []).length, 51),
      countries: goalProgress("countries", (DATA.countriesVisited || []).length, 195),
      towns: goalProgress("towns", towns.filter(t => t.been).length, towns.length || 144),
    },
  };
}
