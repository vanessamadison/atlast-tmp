# ATLAST — the plan

Written 30 Sep 2026, after the competitive research in `COMPETITIVE.md`.

**The thesis in one line:** the market has trackers that record where you went, collectors that
count what you finished, and planners that find you a trail — and none of them close the loop
where *your log becomes the planning input*. That loop is the product. Everything below either
builds it or protects it.

**What we are not chasing:** trail-database breadth (AllTrails has ~400,000 trails, that fight
is over), GPS tracking quality (they get OS-level background access, we don't), a social feed
(needs scale we won't have), or a trophy case (Strava's own forum: *"I have 632 trophies
so... yay?"*).

---

## The honest state of things

| | |
|---|---|
| Built and validated | 188 places, 55 routes, 358-entry merged index, 12 badges, difficulty grid, natural-language capture, three 3D views with real DEM terrain |
| Built and **never seen** | all of it. Nothing in the data layer renders. |
| Biggest risk | **nothing has ever been visually verified by me.** Ten builds, zero looks. |
| Publishing | blocked on the `atlast` repo being disabled by GitHub; `atlast-map` is the workaround |

That second row is the thing to fix first. A validated data layer that nobody has looked at is
a hypothesis, not a feature.

---

## Phase 1 · Make it visible
**The single biggest unlock. Everything else is invisible until this ships.**

- POI pins and route lines on the region views, coloured by interest, sized by the km budget
- Interest filter chips (16 of them) plus a min/max facet panel — stolen from onX, whose "All"
  chip opening sliders for length, time and gain is the best filter UI in the category
- A searchable list panel beside the map, so results can be compared rather than tapped one at
  a time (AllTrails' map view is criticised for exactly this — two taps per candidate)
- Place cards with **provenance badges**: surveyed fact, editorial judgement and inferred value
  rendered differently, with source links
- **The gate: I load it in your browser and look at every view before calling it done.**

**What to expect:** the map finally has something on it. Colorado goes from 4 parks and 58 peaks
to ~226 places. Expect the first look to find three or four things that are wrong — pin sizes in
km, labels colliding, a filter that returns nothing. That is the point of looking.

**Effort:** one long session. **Risk:** low, it is rendering data that already validates.

---

## Phase 2 · The loop
**The thesis, made visible. This is what no competitor can do.**

- A "what next" panel driven by `suggestNext()`, which already computes: the range one summit
  from complete, the empty grid cell with a named candidate, the interest with nothing in it,
  the goal within five of a milestone
- The difficulty grid rendered as Geocaching's matrix, where **the empty cell is the to-do list**
- Badge shelf where every locked badge states what remains (Duolingo's one good idea)
- Endowed progress: tier bars, never a row of zeroes

**What to expect:** the app starts telling you things you did not know. "Shavano + Tabeguache is
your cheapest next pair." "Nothing logged at Class 4 · lethal — Capitol's Knife Edge is the
candidate." This is the first point where ATLAST is better than what you could get elsewhere.

**Effort:** one session. **Risk:** low. The logic exists and is tested.

---

## Phase 3 · Permits — split in two, because the research says so

### 3a · RIDB metadata — safe, do this
Official API at `ridb.recreation.gov/api/v1`, free key, documented, stable. Gives facilities,
permits, tours and the Recreation.gov facility ID — which means **a deep link straight to the
booking page** for every permitted route we hold.

**This alone beats every competitor.** HiiKER is the only app in the category with structured
permit data, and even it only tells you a permit is required.

**Effort:** half a session. **Risk:** low. **Needs from you:** a free RIDB API key.

### 3b · Live availability — the prize, and the fragile part
*"No product integrates Recreation.gov quotas, lottery dates or live reservation inventory, so
at best you learn a permit exists, never whether you can get one."* Filling this would make
ATLAST better than anything on the App Store at the question serious trips actually turn on.

**But I verified it and the news is mixed.** Live availability is **not** in RIDB. It comes from
Recreation.gov's internal endpoints — no authentication, widely used by Camply and similar
tools, but **undocumented**, which means:

- it can change or close without notice, and the feature breaks silently
- polling it is a terms-of-service question I cannot answer for you
- it is a dependency on something nobody promised to keep working

**How I would build it anyway:** behind a feature flag, aggressively cached, rate-limited to a
trickle, and degrading to "check Recreation.gov" with a deep link the moment it fails — so the
app is never *worse* than Phase 3a when the endpoint moves.

**Effort:** one session. **Risk: high, and it is the kind that fails quietly.**
**Needs from you:** a decision on whether polling an undocumented government endpoint is
something you want in a public repo with your name on it.

---

## Phase 4 · Capture, in the interface
The logic is built and tested. This is the UI for it.

- The parse box: type "did grays and torreys" and accept the proposals. Already works in tests.
- Peakbagger's bulk grid — checkbox, optional inline date, one commit. Their help says outright
  *"You don't even have to add a date,"* which is why decades of backlog actually get entered.
- **Photo EXIF backfill.** PeakVisor scans a photo library's GPS to convert past trips into log
  entries, and it is the best capture idea in the research. Perfectly local-first: read EXIF in
  the browser, match coordinates against the index, propose entries. Nothing uploads.

**What to expect:** a decade of history logged in one sitting instead of remembered in chat.
The photo matcher will propose wrong things — it needs an accept/reject pass, not auto-commit.

**Effort:** one session, plus half for the photo matcher. **Risk:** medium. EXIF parsing in the
browser is well-trodden; matching coordinates to the right place is the fiddly part.

---

## Phase 5 · Trips — plan, track, share
The `trips` model already exists in `travel.json` — the Boreas Pass outing created it.

- Day-by-day builder, and Polarsteps' best idea: **warn when the plan is too ambitious for the
  nights booked**
- Trip-level goal yield — a San Juans trip ticking Black Canyon plus four fourteeners plus six
  towns. Nobody computes this, and it is the generalised version of "parks per journey"
- Sharing as a static page with a secret link requiring no account, because that frictionlessness
  is why Polarsteps spreads to non-users

**Effort:** one to two sessions. **Risk:** medium — sharing needs a published artifact, which
means the Pages situation must be resolved first.

---

## Phase 6 · Offline
Table stakes. All 16 outdoor apps ship it, and the ones that ship it *badly* get destroyed in
reviews — forced logins with no signal, missing topography, uncached photos.

Service worker caching terrain tiles, datasets and the app shell. Install as a PWA.

**Effort:** half a session. **Risk:** low, and high value for the phone.

---

## Phase 7 · Profiles, demo, admin
Named local profiles with a switcher and export/import. Onboarding that asks home country and
state and builds the three views around them. Your record preserved as the admin profile, and a
demo button that loads it as a sample.

**Effort:** one session. **Risk:** low.

---

## Phase 8 · Weather windows
Crosses "what I want to do" with "what is possible this weekend" — which nobody joins. Class 4
ridge plus an afternoon storm forecast is a no; Paintbrush Divide still holding snow is a wait.

**api.weather.gov is free and needs no key**, which makes this cheap. US only.

**Effort:** half a session. **Risk:** low.

---

## Phase 9 · The printed artifact
Polarsteps' Travel Book is their actual business, and it is fully automatic — unlocked at five
photos, assembled in minutes, with deliberately coarse edit controls so you cannot stall on it.
A printed ATLAST poster — terrain, routes, filled grid cells, coverage — is the thing people
would put on a wall and ask about.

**Effort:** one session for a print-quality SVG/PDF export. **Risk:** low.

---

## The order, and why

1. **Phase 1** — nothing is real until it renders, and I have never looked at this
2. **Phase 2** — the loop is the thesis; prove it works before adding anything else
3. **Phase 3a** — cheap, safe, and already beats the category on permits
4. **Phase 4** — capture is what keeps the record from rotting
5. **Phase 6** — offline, because it is half a session and transforms the phone
6. **Phase 5** — trips, once there is something worth sharing
7. **Phase 3b** — the prize, but only with eyes open about fragility
8. **Phases 7, 8, 9** — in whatever order the mood takes

## What to expect generally

- **Three to four of these phases will each surface a bug I did not predict.** That has been the
  pattern: the mirrored map, the shared geometry disposal, the duplicate `const`, Indiana Dunes.
  Testing before reporting is the only reason those were caught, and it will keep happening.
- **`verify.mjs` grows with every phase.** It has already caught mixed cache-busters, a missing
  export, a scale budget violation and the north-south mirror. Every new invariant goes in it.
- **Novelty decays by week six.** Pokémon GO's step gain was fully gone by then. The phases that
  survive that are the useful ones — the loop, permits, capture — not the decorative ones.
- **One phase at a time, verified, before the next.** The alternative is eight half-built
  features and no idea which one is broken.

## What I will not build without you asking twice

Speed leaderboards, league tiers, volume badges, or rigid streaks. The research is unambiguous
that all four either decay or actively distort behaviour, and a 2020→2025 ethics review of
Untappd found its volume-reward badges largely unfixed five years after being flagged.
