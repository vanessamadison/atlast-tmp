// ATLAST — coverage map. Scene, views, drill-down, interaction.
//
// BUILD at-r10.0
//
// Three views and one drill-down. USA and Globe are overviews; clicking anything in either
// pushes into a region view, which is the Colorado treatment applied generically — extruded
// slab, real DEM terrain clipped to the real border, her own markers on top, card alongside.
// Colorado is no longer special-cased; it is just the region with towns and fourteeners.
//
// Orientation, because this was wrong for six builds and mirroring is invisible until checked:
// the projections here return y increasing NORTHWARD. Shapes build in (X,Y) and rotate -90°
// about X, sending shape-Y to world -Z. So flat() must NOT negate y — north then lands at -Z,
// furthest from a camera on +Z, which reads as up. The old build negated; because polygons and
// markers were mirrored together, every relative check passed. verify.mjs checks it absolutely.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PARKS } from "./parks.js?v=14";
import { elev } from "./terrain.js?v=14";
import {
  decodeTopo, albers, laea, lonLatToSphere, bboxOf, inside,
  lonLatBBox, lonLatBBoxUnwrapped, unwrapFeature,
} from "./geo.js?v=14";
import { S, C, TINT, ramp, reliefUnits } from "./style.js?v=14";
import { STATE, ABBR, CONTINENT, canonCountry } from "./states.js?v=14";
import { store } from "./store.js?v=14";
import { loadDEM, loadDEMProgressive, pickZoom, DEM_SOURCE_NOTE } from "./dem.js?v=14";
import { projectorFor, slabGroup, borderLine, terrainMesh, sampler } from "./region.js?v=14";
import { mountCard, openState, openCountry, closeCard } from "./card.js?v=14";
import { buildPlaces, auditPlaces } from "./places.js?v=14";
import { mountPanel } from "./panel.js?v=14";
import { evaluate } from "./progress.js?v=14";
import { markDone, suggestNext } from "./capture.js?v=14";

export const BUILD = "at-r10.0";

const QS = new URLSearchParams(location.search);

// A phone is not a laptop. Terrain resolution, tile count and sphere density all come down
// together — a 480k-cell region mesh and 64 elevation tiles will drop a phone to single-figure
// frames and eat someone's data plan doing it. Everything else about the map is identical.
export const COMPACT = matchMedia("(max-width: 820px)").matches;
export const TOUCH = matchMedia("(pointer: coarse)").matches;
const PERF = COMPACT
  ? { pixelRatio: 1.6, tiles: 24, cellsUS: 90000, cellsRegion: 150000, cellsInset: 12000,
      globeSeg: [256, 128], globeTiles: 20 }
  : { pixelRatio: 2, tiles: 48, cellsUS: 320000, cellsRegion: 480000, cellsInset: 42000,
      globeSeg: [512, 256], globeTiles: 80 };

const TILE_BUDGET = Math.max(4, Math.min(200, +(QS.get("tiles") || PERF.tiles)));
// ?exag=22 for more drama. The header pill always states the number in use, so turning this
// up is a choice she can see rather than a lie the map tells her.
const EXAG_Q = +QS.get("exag");
if (EXAG_Q > 0) S.EXAG = Math.max(1, Math.min(60, EXAG_Q));

/* ── boot ─────────────────────────────────────────────────────────────── */
const errEl = document.getElementById("err");
const subEl = document.getElementById("sub");
const backEl = document.getElementById("back");
const wipeEl = document.getElementById("wipe");
const fail = m => { errEl.textContent = String(m?.stack || m); console.error(m); };
addEventListener("error", e => fail("ERROR " + e.message));
addEventListener("unhandledrejection", e => fail("PROMISE " + (e.reason?.message || e.reason)));

const cv = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, PERF.pixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color(C.bg);
// No fog. FogExp2 at 0.055 with the camera 46 units out leaves 0.17% of the colour and the
// screen goes black with nothing broken. If it ever goes dark, look here first.
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 8000);
const controls = new OrbitControls(camera, cv);
controls.enableDamping = true;
controls.dampingFactor = 0.075;

scene.add(new THREE.AmbientLight(0xffffff, 0.62));
const sun = new THREE.DirectionalLight(0xfff4e2, 1.5);
sun.position.set(-70, 120, 60);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x93bcdd, 0x141a12, 0.55));
const rimLight = new THREE.DirectionalLight(0x9fd0ff, 0.35);
rimLight.position.set(80, 40, -70);
scene.add(rimLight);

let DATA, STATES, WORLD, WORLD50, INDEX = null, PANEL = null, PROGRESS = null;
let poiFilter = null;      // the rows the panel last produced, or null for "everything"
let poiRootRef = null;     // the live POI group, so a filter change repaints only it
const group = new THREE.Group();
scene.add(group);
let hoverables = [], pulses = [];
let token = 0;                       // invalidates in-flight async builds
let nav = { view: "us" };            // { view: "us"|"globe"|"region", spec, parent }
const alive = t => () => t === token;

// Geometries and textures reused across every marker in every view. Disposing one of these
// with the rest of a rebuilt group silently breaks every marker drawn afterwards — and the
// terrain layer rebuilds three times per view, so it breaks fast.
const SHARED = new Set();

function disposeTree(o) {
  o.traverse?.(n => {
    if (n.geometry && !SHARED.has(n.geometry)) n.geometry.dispose();
    const kill = x => {
      if (x.map && !SHARED.has(x.map)) x.map.dispose();
      x.dispose?.();
    };
    const m = n.material;
    if (Array.isArray(m)) m.forEach(kill);
    else if (m) kill(m);
  });
}
function emptyGroup(g) { while (g.children.length) disposeTree(g.children.pop()); }

// Anything removed from the scene must leave the raycast list with it, or hovering hits a
// disposed mesh that is no longer drawn.
const attached = o => { let p = o; while (p) { if (p === scene) return true; p = p.parent; } return false; };
function pruneHoverables() {
  hoverables = hoverables.filter(attached);
  pulses = pulses.filter(attached);
}

function clear() { hoverables = []; pulses = []; group.rotation.y = 0; emptyGroup(group); }

const resize = () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  // Turning a phone sideways moves the card from the bottom to the side, which changes what
  // the camera has to frame around.
  reframe();
};
addEventListener("resize", resize);
addEventListener("orientationchange", () => setTimeout(resize, 120));

/* ── geometry helpers ─────────────────────────────────────────────────── */
const SPH = new THREE.SphereGeometry(1, 14, 12);
const RINGG = new THREE.RingGeometry(0.72, 1, 28);
SHARED.add(SPH); SHARED.add(RINGG);

function marker(colour, on, scale = 1) {
  const g = new THREE.Group();
  const r = (on ? S.DOT_ON : S.DOT) * scale, h = (on ? S.STEM_ON : S.STEM) * scale;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.14, r * 0.14, h, 5),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.4 }));
  stem.position.y = h / 2; g.add(stem);
  const dot = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: colour }));
  dot.scale.setScalar(r); dot.position.y = h; g.add(dot);
  const ring = new THREE.Mesh(RINGG, new THREE.MeshBasicMaterial({ color: colour,
    transparent: true, opacity: on ? 0.32 : 0.14, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.scale.setScalar((on ? S.RING : S.RING * 0.7) * scale);
  ring.position.y = 0.02; g.add(ring);
  if (on) { g.userData.ring = ring; pulses.push(g); }
  return { g, hit: dot, top: h };
}

function tube(pts, colour, r, op) {
  if (pts.length < 2) return null;
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(40, pts.length * 8), r, 6, false),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: op ?? 0.7 }));
}

// Geometry needs unwrapped longitude; point-in-polygon tests against her raw coordinates do
// not, because every projection here is trigonometric and 192° and −168° are the same angle.
const unwrapped = f => ({ name: f.name, rings: unwrapFeature(f.rings) });

function hoverable(obj, title, sub, click) {
  obj.userData.hover = { title, sub };
  if (click) obj.userData.click = click;
  hoverables.push(obj);
  return obj;
}

let HALO_TEX = null;
function haloTexture() {
  if (HALO_TEX) return HALO_TEX;
  const n = 128, c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  // Tight core, quick falloff. A soft wide gradient at globe scale reads as a smudge the size
  // of a country rather than as a place.
  const grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grd.addColorStop(0, "rgba(214,244,168,0.9)");
  grd.addColorStop(0.16, "rgba(180,216,120,0.34)");
  grd.addColorStop(0.5, "rgba(168,204,112,0.09)");
  grd.addColorStop(1, "rgba(168,204,112,0)");
  g.fillStyle = grd; g.fillRect(0, 0, n, n);
  HALO_TEX = new THREE.CanvasTexture(c);
  SHARED.add(HALO_TEX);
  return HALO_TEX;
}

/* ── derived indexes ──────────────────────────────────────────────────── */
let stateRings = new Map(), cityState = new Map(), cityCountry = new Map(), routeStates = [];

// Canonicalise polygon names once, at decode, so nothing downstream has to remember to.
const canonNames = feats => { for (const f of feats) f.name = canonCountry(f.name); return feats; };

// A visited country that matches no polygon is invisible on the globe and reads "not yet" on
// its card, with no error anywhere. Say so, loudly, in the console.
function warnUnmatchedCountries() {
  const known = new Set(WORLD.map(f => f.name));
  const missing = DATA.countriesVisited.filter(n => !known.has(n));
  if (missing.length) {
    console.warn("[atlast] countriesVisited entries with no polygon:", missing,
      "— add an alias in states.js COUNTRY_ALIAS or fix the name in travel.json");
  }
}

function buildIndexes() {
  stateRings = new Map();
  for (const f of STATES) { const c = ABBR[f.name]; if (c) stateRings.set(c, f.rings); }
  cityState = new Map();
  cityCountry = new Map();
  for (const city of DATA.cities) {
    for (const [code, rings] of stateRings) {
      if (inside(city.lon, city.lat, rings)) { cityState.set(city.name, code); break; }
    }
    for (const f of WORLD) {
      if (inside(city.lon, city.lat, f.rings)) { cityCountry.set(city.name, f.name); break; }
    }
  }
  routeStates = (DATA.routes || []).map(rt => {
    const set = new Set();
    for (const [la, lo] of rt.pts) {
      for (const [code, rings] of stateRings) {
        if (inside(lo, la, rings)) { set.add(code); break; }
      }
    }
    return set;
  });
}

const citiesIn = code => DATA.cities.filter(c => cityState.get(c.name) === code);
const citiesInCountry = name => DATA.cities.filter(c => cityCountry.get(c.name) === name);
const routesIn = code => (DATA.routes || []).filter((_, i) => routeStates[i]?.has(code));

const cardCtx = () => ({
  DATA, PARKS, citiesIn, citiesInCountry, routesIn,
  coTownsIn: () => ({ all: DATA.coTowns || [], been: (DATA.coTowns || []).filter(t => t.been) }),
  continentOf: name => CONTINENT[name] || "",
  continentCount: () => new Set(DATA.countriesVisited.map(n => CONTINENT[n]).filter(Boolean)).size,
});

/* ── terrain layer ────────────────────────────────────────────────────────
   Shared by the USA overview (51 small meshes on one DEM) and the region view (one big mesh).
   Progressive: a coarse pass paints immediately so the view never stalls, then the full
   resolution swaps in. Every mesh in a layer shares one elevation ramp, or each state would
   look like it has its own private mountain range. */
async function terrainLayer(opts) {
  const {
    feats, P, root, bounds, budget = TILE_BUDGET, base, span = S.MAP,
    fallback, tintFor = () => TINT.neutral, cellsTotal = 120000,
    decorate, myToken, onStatus, quiet = false,
  } = opts;

  const [south, north, west, east] = bounds;
  const midLat = (south + north) / 2;
  const widthKm = Math.abs(east - west) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  const heightKm = Math.abs(north - south) * 110.57;
  const kmPerUnit = Math.max(widthKm, heightKm) / span;

  // Geometry works in unwrapped longitude so Alaska is a 58°-wide region rather than a
  // 358°-wide one. A no-op for every other feature.
  const ufeats = feats.map(unwrapped);

  // projected-area share, so Texas gets more triangles than Rhode Island
  const areas = ufeats.map(f => {
    const [x0, y0, x1, y1] = bboxOf([f], P.project);
    return Math.max(1e-9, (x1 - x0) * (y1 - y0));
  });
  const areaSum = areas.reduce((a, b) => a + b, 0);

  let painted = null;

  const paint = (dem, isFinal) => {
    if (myToken !== token) return;
    const smp = sampler(dem, fallback);
    // The first two passes exist so the view is never blank; they do not need the full
    // triangle budget, and paying it three times over is what would make this feel slow.
    const cellBudget = isFinal ? cellsTotal : Math.round(cellsTotal * 0.22);

    // Pre-scan for the shared ramp. Cheap, and far better than guessing a range.
    let lo = 1e9, hi = -1e9;
    for (let j = 0; j <= 48; j++) {
      for (let i = 0; i <= 72; i++) {
        const ft = smp(west + (east - west) * (i / 72), north - (north - south) * (j / 48));
        if (ft < lo) lo = ft;
        if (ft > hi) hi = ft;
      }
    }
    const eMin = Math.max(-300, Math.min(lo, 0));
    const eMax = Math.max(eMin + 500, hi);
    const relief = reliefUnits(eMax - eMin, kmPerUnit);

    emptyGroup(root);
    const built = [];
    ufeats.forEach((f, i) => {
      const share = areas[i] / areaSum;
      const cells = Math.round(Math.max(400, Math.min(cellBudget, cellBudget * share)));
      const m = terrainMesh(f, P, {
        bounds: lonLatBBoxUnwrapped(f.rings),
        ftAt: smp, base, relief, eMin, eMax, cells, tint: tintFor(f),
      });
      if (m) { root.add(m); built.push({ feature: f, mesh: m }); }
    });

    const yAt = (lon, lat) => base +
      ((Math.min(eMax, Math.max(eMin, smp(lon, lat))) - eMin) / (eMax - eMin)) * relief;

    painted = { smp, eMin, eMax, relief, yAt, built, kmPerUnit };
    decorate?.(painted, isFinal);
    pruneHoverables();
    onStatus?.(dem, smp, isFinal);
    return painted;
  };

  // Draw something instantly from the fallback so nothing is ever blank.
  paint(null, false);

  await loadDEMProgressive(bounds, {
    budget, coarseBudget: Math.max(4, Math.round(budget / 6)),
    alive: alive(myToken),
    onProgress: (d, n) => {
      if (!quiet && myToken === token && d % 4 === 0) subEl.textContent = `elevation ${d}/${n}`;
    },
    onPass: paint,
  });
  return painted;
}

function demStatusText(dem, smp) {
  if (!dem || !dem.got) return { text: "procedural relief — DEM tiles did not load", good: false };
  const share = Math.round(smp.share() * 100);
  if (share > 98) {
    return { text: `real DEM · z${dem.zoom} · ${Math.round(dem.metresPerPixel)} m/px · ${S.EXAG}× vertical`, good: true };
  }
  return { text: `DEM ${share}% · procedural fill ${100 - share}% · ${S.EXAG}× vertical`, good: false };
}

/* ── USA overview ─────────────────────────────────────────────────────── */
const SKIP_CONUS = new Set(["Alaska", "Hawaii", "Puerto Rico", "Virgin Islands",
  "Guam", "American Samoa", "Commonwealth of the Northern Mariana Islands"]);

// Globe sphere resolution, and the shell radii for everything drawn on top of it. Everest
// displaces the surface by ~0.66 units (R×1.0194), so every overlay sits above 1.020 or the
// Himalaya pokes through the borders.
const [GLOBE_SEG_W, GLOBE_SEG_H] = PERF.globeSeg;
const R_BORDER = 1.024, R_STATE = 1.026, R_PICK = 1.028, R_HALO = 1.027,
  R_ROUTE = 1.030, R_CITY = 1.031;

async function buildUS() {
  const myToken = ++token;
  clear();
  const been = new Set(DATA.statesVisited);
  const visP = new Set(DATA.parksVisited);
  const sug = new Map((DATA.suggestions || []).map(x => [x.park, x.why]));

  const conus = STATES.filter(f => !SKIP_CONUS.has(f.name));
  const P = projectorFor(albers, bboxOf(conus, albers), S.MAP);

  // Slabs first — instant structure, and the sides are what make it read as 3D from above.
  const slabRoot = new THREE.Group();
  group.add(slabRoot);
  for (const f of conus) {
    const code = ABBR[f.name];
    const on = code ? been.has(code) : false;
    const g = slabGroup(f, P, {
      depth: on ? S.SLAB_US_ON : S.SLAB_US,
      cap: on ? C.landOn : C.landOff,
      side: on ? C.slabSideOn : C.slabSide,
      edge: on ? C.edgeOn : C.edgeOff,
      edgeOpacity: on ? 0.85 : 0.5,
    });
    slabRoot.add(g);
  }

  const terrRoot = new THREE.Group();
  group.add(terrRoot);
  const markRoot = new THREE.Group();
  group.add(markRoot);

  // Orbit here too. The original brief locked this camera top-down, but a slab map with real
  // relief on it wants to be tilted, and having one view behave differently from the rest is
  // its own kind of friction. Polar angle is clamped so you cannot get under the map.
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = 1.36;
  controls.minDistance = 26;
  controls.maxDistance = 300;
  setTouchMode("map");

  const decorate = ({ yAt, built }) => {
    // Hover and click live on the terrain, which is what the cursor actually meets.
    for (const { feature, mesh } of built) {
      const code = ABBR[feature.name];
      if (!code) continue;
      mesh.userData.stateCode = code;
      hoverable(mesh, STATE[code]?.name || feature.name,
        (been.has(code) ? "verified" : "not yet") + " · click to drop in",
        () => drillState(code));
    }
    emptyGroup(markRoot);
    for (const rv of RIVERS) {
      const t = tube(rv.map(([la, lo]) => { const [X, Z] = P.world(lo, la);
        return new THREE.Vector3(X, yAt(lo, la) + 0.06, Z); }), C.river, S.RIVER, 0.55);
      if (t) markRoot.add(t);
    }
    for (const rt of (DATA.routes || [])) {
      const p = rt.pts.filter(q => q[0] < 50 && q[0] > 24 && q[1] > -126 && q[1] < -66)
        .map(([la, lo]) => { const [X, Z] = P.world(lo, la);
          return new THREE.Vector3(X, yAt(lo, la) + 0.12, Z); });
      const t = tube(p, rt.mode === "rail" ? C.rail : C.road, S.ROAD, 0.85);
      if (t) { markRoot.add(t); hoverable(t, rt.name, rt.year || "year not recorded"); }
    }
    for (const p of PARKS) {
      if (p.lat > 50 || p.lat < 24 || p.lon < -126 || p.lon > -66) continue;
      const on = visP.has(p.name), s = !on && sug.has(p.name);
      const [X, Z] = P.world(p.lon, p.lat);
      const { g, hit } = marker(on ? C.park : s ? C.next : C.miss, on || s);
      g.position.set(X, yAt(p.lon, p.lat), Z);
      hoverable(hit, p.name, (on ? "visited" : s ? sug.get(p.name) : "not yet") + " · " + p.state,
        () => STATE[p.state] && drillState(p.state));
      markRoot.add(g);
    }
  };

  const layer = terrainLayer({
    feats: conus, P, root: terrRoot, base: S.SLAB_US,
    bounds: lonLatBBox(conus.flatMap(f => f.rings)),
    budget: TILE_BUDGET, span: S.MAP, cellsTotal: PERF.cellsUS,
    fallback: (lon, lat) => elev(lat, lon, "us"),
    tintFor: f => (been.has(ABBR[f.name]) ? TINT.on : TINT.off),
    decorate, myToken,
    onStatus: (dem, smp, isFinal) => {
      if (myToken !== token) return;
      const st = demStatusText(dem, smp);
      setSource(st.text, st.good);
      subEl.textContent = "united states · 63 parks · 51 states";
      if (isFinal) legend(["click a state to drop into it", "#a8cc70 visited", "#e3c765 suggested",
        "#d9963f drives", "#4f93b5 rivers",
        dem?.got ? DEM_SOURCE_NOTE : "terrain.js procedural fallback"]);
    },
  });

  // Insets, placed by measuring the mainland rather than by typing in coordinates.
  const conusBox = new THREE.Box3().setFromObject(slabRoot);
  let cursorX = conusBox.min.x;
  for (const spec of [{ name: "Alaska", span: 24 }, { name: "Hawaii", span: 10 }]) {
    const f = STATES.find(x => x.name === spec.name);
    if (!f) continue;
    const code = ABBR[f.name], on = been.has(code);
    const uf = unwrapped(f);
    const bb = lonLatBBox(uf.rings);
    const proj = laea((bb[2] + bb[3]) / 2, (bb[0] + bb[1]) / 2);
    const IP = projectorFor(proj, bboxOf([uf], proj), spec.span);
    const holder = new THREE.Group();
    holder.add(slabGroup(uf, IP, {
      depth: on ? S.INSET_SLAB * 1.7 : S.INSET_SLAB,
      cap: on ? C.landOn : C.landOff, side: on ? C.slabSideOn : C.slabSide,
      edge: on ? C.edgeOn : C.edgeOff, edgeOpacity: on ? 0.85 : 0.5,
    }));
    const it = new THREE.Group();
    holder.add(it);
    group.add(holder);
    const b = new THREE.Box3().setFromObject(holder);
    holder.position.x += cursorX - b.min.x;
    holder.position.z += conusBox.max.z + 5 - b.min.z;
    cursorX += (b.max.x - b.min.x) + 5;

    terrainLayer({
      feats: [f], P: IP, root: it, base: on ? S.INSET_SLAB * 1.7 : S.INSET_SLAB,
      bounds: bb, budget: 12, span: spec.span, cellsTotal: PERF.cellsInset,
      fallback: () => 0,
      tintFor: () => (on ? TINT.on : TINT.off),
      myToken, quiet: true,
      decorate: ({ built }) => {
        for (const { mesh } of built) {
          hoverable(mesh, STATE[code]?.name || f.name,
            (on ? "verified" : "not yet") + " · click to drop in", () => drillState(code));
        }
      },
    });
  }

  // Centre on the mainland, not on the average of the mainland and two insets parked to the
  // south-west — that average is what made the map sit slightly off-centre.
  frame(new THREE.Vector3(0, 0.787, 0.617), 1.06, conusBox.getCenter(new THREE.Vector3()));
  const sc = PARKS.filter(p => !visP.has(p.name) && sug.has(p.name)).length;
  stats([[DATA.parksVisited.length, "of 63 parks"],
    [Math.round((DATA.parksVisited.length / 63) * 100) + "%", "park coverage"],
    [DATA.statesVisited.length, "of 51 states"], [sc, "suggested next"]]);
  legend(["click a state to drop into it", "#a8cc70 visited", "#e3c765 suggested",
    "#d9963f drives", "#4f93b5 rivers"]);
  // Deliberately NOT awaited. The first paint is already on screen; making the caller wait
  // for every elevation tile would hold the transition open for the whole download.
  void layer;
}

/* ── REGION view — any state, any country ─────────────────────────────── */
async function buildRegion(spec) {
  const myToken = ++token;
  clear();
  const { feature, code, country, title } = spec;
  const uf = unwrapped(feature);
  const bb = lonLatBBox(uf.rings);
  const [south, north, west, east] = bb;
  const proj = laea((west + east) / 2, (south + north) / 2);
  const P = projectorFor(proj, bboxOf([uf], proj), S.MAP);

  const been = code
    ? new Set(DATA.statesVisited).has(code)
    : new Set(DATA.countriesVisited).has(country);

  group.add(slabGroup(uf, P, {
    depth: S.SLAB_REGION, cap: C.landOff, side: been ? C.slabSideOn : C.slabSide,
    edge: been ? C.edgeOn : C.edgeOff, edgeOpacity: 0.6,
  }));
  const terrRoot = new THREE.Group(); group.add(terrRoot);
  const markRoot = new THREE.Group(); group.add(markRoot);
  const poiRoot = new THREE.Group(); group.add(poiRoot);
  poiRootRef = poiRoot;

  const visP = new Set(DATA.parksVisited);
  const sug = new Map((DATA.suggestions || []).map(x => [x.park, x.why]));
  const isCO = code === "CO";
  const inRegion = (lon, lat) => inside(lon, lat, feature.rings);

  const decorate = ({ yAt }) => {
    emptyGroup(markRoot);
    markRoot.add(borderLine(uf, P, yAt, been ? C.edgeOn : C.edgeOff, 0.75));

    // Every region gets its POI layer, not just Colorado. regionCtx is what lets a row in the
    // list panel move the camera to a pin.
    regionCtx = { P, yAt, code, country };
    buildPOIs(poiRoot, P, yAt, poiFilter, { scale: 0.9 });

    for (const rt of (DATA.routes || [])) {
      const p = rt.pts.filter(([la, lo]) => inRegion(lo, la))
        .map(([la, lo]) => { const [X, Z] = P.world(lo, la);
          return new THREE.Vector3(X, yAt(lo, la) + 0.14, Z); });
      const t = tube(p, rt.mode === "rail" ? C.rail : C.road, S.ROAD * 0.8, 0.8);
      if (t) { markRoot.add(t); hoverable(t, rt.name, rt.year || "year not recorded"); }
    }
    if (isCO) {
      for (const rv of CO_RIVERS) {
        const t = tube(rv.map(([la, lo]) => { const [X, Z] = P.world(lo, la);
          return new THREE.Vector3(X, yAt(lo, la) + 0.09, Z); }), C.river, S.RIVER * 0.8, 0.65);
        if (t) markRoot.add(t);
      }
    }

    for (const p of PARKS) {
      if (code ? p.state !== code : !inRegion(p.lon, p.lat)) continue;
      const on = visP.has(p.name);
      const [X, Z] = P.world(p.lon, p.lat), y = yAt(p.lon, p.lat);
      const { g, hit } = marker(on ? C.park : sug.has(p.name) ? C.next : C.miss, true, 0.85);
      g.position.set(X, y, Z);
      hoverable(hit, p.name, on ? "visited" : sug.get(p.name) || "not yet");
      markRoot.add(g);
    }

    const cities = code ? citiesIn(code) : citiesInCountry(country);
    for (const c of cities) {
      const [X, Z] = P.world(c.lon, c.lat), y = yAt(c.lon, c.lat);
      const d = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: C.town }));
      d.scale.setScalar(S.TOWN * 1.6);
      d.position.set(X, y + 0.14, Z);
      hoverable(d, c.name, "logged");
      markRoot.add(d);
    }

    if (isCO) {
      for (const t of (DATA.coTowns || [])) {
        const [X, Z] = P.world(t.lon, t.lat), y = yAt(t.lon, t.lat);
        const d = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({
          color: t.been ? C.town : 0x4d5648, transparent: !t.been, opacity: t.been ? 1 : 0.55 }));
        d.scale.setScalar(t.been ? S.TOWN : S.TOWN_OFF);
        d.position.set(X, y + 0.1, Z);
        hoverable(d, t.name, (t.been ? "been" : "not yet") + " · " + t.region.toLowerCase());
        markRoot.add(d);
      }
      for (const f of (DATA.fourteeners || [])) {
        const [X, Z] = P.world(f.lon, f.lat), y = yAt(f.lon, f.lat);
        const up = f.summited, pl = f.planned;
        const h = S.PEAK * (0.55 + ((f.ft - 14000) / 440) * 0.8);
        const colr = up ? C.summit : pl ? C.next : 0x7d8a77;
        const sh = new THREE.Mesh(new THREE.CylinderGeometry(up ? 0.075 : pl ? 0.065 : 0.035, 0.012, h, 5),
          new THREE.MeshBasicMaterial({ color: colr, transparent: true,
            opacity: up ? 0.95 : pl ? 0.85 : 0.4 }));
        sh.position.set(X, y + h / 2, Z);
        hoverable(sh, f.name, f.ft.toLocaleString() + " ft"
          + (f.cls ? ` · class ${f.cls} · ${f.mi} mi · ${f.gain.toLocaleString()} ft gain` : "")
          + (f.drive ? ` · ${f.drive} from Denver` : "")
          + (up ? " · SUMMITED" : pl ? " · PLANNED" : ""));
        markRoot.add(sh);
        if (up || pl) {
          const cap = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: colr }));
          cap.scale.setScalar(up ? 0.15 : 0.12);
          cap.position.set(X, y + h, Z);
          markRoot.add(cap);
        }
      }
    } else if (code && STATE[code]) {
      // Every state gets its high point as a marker, since that is the one peak fact that is
      // sourced rather than estimated.
      const [hpName, hpFt, hpLat, hpLon] = STATE[code].hp;
      if (inRegion(hpLon, hpLat)) {
        const [X, Z] = P.world(hpLon, hpLat), y = yAt(hpLon, hpLat);
        const h = S.PEAK * 0.8;
        const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.012, h, 5),
          new THREE.MeshBasicMaterial({ color: C.summit, transparent: true, opacity: 0.85 }));
        sh.position.set(X, y + h / 2, Z);
        hoverable(sh, hpName, hpFt.toLocaleString() + " ft · state high point");
        markRoot.add(sh);
      }
    }
  };

  controls.enableRotate = true;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.minDistance = 18;
  controls.maxDistance = 400;
  controls.maxPolarAngle = 1.36;
  setTouchMode("map");

  const layer = terrainLayer({
    feats: [feature], P, root: terrRoot, base: S.SLAB_REGION, bounds: bb,
    budget: TILE_BUDGET, span: S.MAP, cellsTotal: PERF.cellsRegion,
    fallback: code ? (lon, lat) => elev(lat, lon, code === "CO" ? "co" : "us") : () => 0,
    tintFor: () => (been ? TINT.on : TINT.off),
    decorate, myToken,
    onStatus: (dem, smp, isFinal) => {
      if (myToken !== token) return;
      const st = demStatusText(dem, smp);
      setSource(st.text, st.good);
      subEl.textContent = title.toLowerCase();
      if (isFinal && !dem?.got && !code) {
        legend(["no elevation tiles for this region", "terrain shown flat rather than invented"]);
      }
    },
  });

  PANEL?.setRegion(code || null);
  frame(new THREE.Vector3(0, 0.62, 0.78), 1.02);

  if (isCO) {
    const tb = (DATA.coTowns || []).filter(t => t.been).length;
    stats([[PARKS.filter(p => p.state === "CO" && visP.has(p.name)).length, "of 4 CO parks"],
      [tb, "of " + (DATA.coTowns || []).length + " towns"],
      [(DATA.fourteeners || []).filter(f => f.summited).length, "of 58 fourteeners"],
      [Math.round((tb / Math.max(1, (DATA.coTowns || []).length)) * 100) + "%", "town coverage"]]);
    legend(["zoom out to go back", "#f2f6ee summited", "#e3c765 planned", "#86a8c4 towns",
      "#4f93b5 rivers"]);
  } else if (code) {
    const parks = PARKS.filter(p => p.state === code);
    stats([[parks.filter(p => visP.has(p.name)).length, "of " + (parks.length || 0) + " parks"],
      [citiesIn(code).length, "cities logged"],
      [routesIn(code).length, "routes through"],
      [STATE[code] ? STATE[code].hp[1].toLocaleString() : "—", "ft high point"]]);
    legend(["zoom out to go back", "#a8cc70 visited park", "#e3c765 suggested",
      "#86a8c4 city logged", "#f2f6ee high point"]);
  } else {
    stats([[citiesInCountry(country).length, "cities logged"],
      [been ? "yes" : "no", "verified"],
      [CONTINENT[country] || "—", "continent"],
      [DATA.countriesVisited.length, "of 195 countries"]]);
    legend(["zoom out to go back", "#86a8c4 city logged", "#d9963f routes"]);
  }
  void layer;   // see buildUS — the transition must not wait on the tile download
}

/* ── GLOBE ────────────────────────────────────────────────────────────────
   Not a flood fill. Every border lit, and a visited country shows the footprint she can
   actually evidence: a halo at each logged city and her real routes drawn on the sphere.
   A country she has barely touched looks barely touched, which is the honest picture. */
async function buildGlobe() {
  const myToken = ++token;
  clear();
  const R = S.GLOBE_R;
  const been = new Set(DATA.countriesVisited);
  const feats = WORLD50 || WORLD;

  // Dense enough to carry z3 elevation without stair-stepping: 0.7° of latitude per row is
  // ~78 km, against a ~19 km DEM pixel.
  const globeGeo = new THREE.SphereGeometry(R, GLOBE_SEG_W, GLOBE_SEG_H);
  const globe = new THREE.Mesh(globeGeo, new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.95, metalness: 0.05, vertexColors: true }));
  const vcount = globeGeo.attributes.position.count;
  const seaC = new THREE.Color(C.globeSea);
  const initCol = new Float32Array(vcount * 3);
  for (let i = 0; i < vcount; i++) {
    initCol[i * 3] = seaC.r; initCol[i * 3 + 1] = seaC.g; initCol[i * 3 + 2] = seaC.b;
  }
  globeGeo.setAttribute("color", new THREE.BufferAttribute(initCol, 3));
  group.add(globe);

  const N = 1600, sp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 500 + Math.random() * 900, t = Math.random() * 6.283, p = Math.acos(2 * Math.random() - 1);
    sp[i * 3] = r * Math.sin(p) * Math.cos(t);
    sp[i * 3 + 1] = r * Math.cos(p);
    sp[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  group.add(new THREE.Points(sg, new THREE.PointsMaterial({
    color: 0xeef2ea, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.38 })));

  // Country borders — all of them lit, visited ones brighter and thicker-looking.
  for (const f of feats) {
    const on = been.has(f.name);
    for (const ring of f.rings) {
      const pts = ring.map(([lo, la]) => new THREE.Vector3(...lonLatToSphere(lo, la, R * R_BORDER)));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: on ? C.borderOn : C.borderOff,
          transparent: true, opacity: on ? 1 : 0.6 })));
    }
    if (on) {
      // A wide, low-opacity pick target so a country is clickable without being filled in.
      for (const ring of f.rings) {
        const pts = ring.map(([lo, la]) => new THREE.Vector3(...lonLatToSphere(lo, la, R * R_PICK)));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: C.borderOn, transparent: true, opacity: 0.22 }));
        hoverable(line, f.name,
          `visited · ${citiesInCountry(f.name).length} places logged · click to drop in`,
          () => drillCountry(f.name));
        group.add(line);
      }
    }
  }

  // US state borders, so the country she has covered most reads as a grid, not a blob.
  for (const f of STATES) {
    if (SKIP_CONUS.has(f.name) && f.name !== "Alaska" && f.name !== "Hawaii") continue;
    for (const ring of f.rings) {
      const pts = ring.map(([lo, la]) => new THREE.Vector3(...lonLatToSphere(lo, la, R * R_STATE)));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: C.borderState, transparent: true, opacity: 0.42 })));
    }
  }

  // Her actual routes, on the sphere.
  for (const rt of (DATA.routes || [])) {
    const pts = rt.pts.map(([la, lo]) => new THREE.Vector3(...lonLatToSphere(lo, la, R * R_ROUTE)));
    if (pts.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(pts);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(pts.length * 12)),
      new THREE.LineBasicMaterial({ color: rt.mode === "rail" ? C.rail : C.road,
        transparent: true, opacity: 0.9 }));
    hoverable(line, rt.name, rt.year || "year not recorded");
    group.add(line);
  }

  // Footprint halos — one per logged city, oriented flat against the sphere.
  const haloMat = new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true,
    depthWrite: false, opacity: 0.7, side: THREE.DoubleSide });
  const haloGeo = new THREE.PlaneGeometry(S.GLOBE_HALO * 2, S.GLOBE_HALO * 2);
  for (const c of DATA.cities) {
    const p = new THREE.Vector3(...lonLatToSphere(c.lon, c.lat, R * R_HALO));
    const h = new THREE.Mesh(haloGeo, haloMat);
    h.position.copy(p);
    h.lookAt(p.clone().multiplyScalar(2));
    group.add(h);

    const m = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: C.park }));
    m.scale.setScalar(S.GLOBE_DOT);
    m.position.copy(new THREE.Vector3(...lonLatToSphere(c.lon, c.lat, R * R_CITY)));
    const country = cityCountry.get(c.name);
    hoverable(m, c.name, country || "city", () => country && drillCountry(country));
    group.add(m);
  }

  controls.enableRotate = true;
  controls.enablePan = false;
  controls.minDistance = 42;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI;
  setTouchMode("globe");
  ease(new THREE.Vector3(44, 26, 62), new THREE.Vector3(0, 0, 0));

  const ctx = cardCtx();
  stats([[DATA.countriesVisited.length, "of 195 countries"],
    [DATA.cities.length, "cities logged"],
    [ctx.continentCount() + "/7", "continents"],
    [Math.round((DATA.countriesVisited.length / 195) * 100) + "%", "of the world"]]);
  legend(["click a lit country to drop in", "#caeb96 visited border", "halo = a place logged",
    "africa · oceania · antarctica remain"]);

  // Relief on the sphere itself. Fired and forgotten so the globe is interactive immediately
  // and no transition is ever held open by it.
  void (async () => {
    const bounds = [-85, 85, -180, 180];
    const zoom = pickZoom(bounds, PERF.globeTiles, 2, 4);        // z3 — 64 tiles, ~19 km/px at the equator
    subEl.textContent = "the world · elevation";
    const dem = await loadDEM(bounds, zoom,
      (d, n) => { if (myToken === token && d % 8 === 0) subEl.textContent = `the world · elevation ${d}/${n}`; });
    if (myToken !== token) return;
    if (!dem?.got) {
      setSource("world-atlas 50m · no globe relief", false);
      subEl.textContent = "the world · 195 countries";
      return;
    }

    const pos = globeGeo.attributes.position, col = globeGeo.attributes.color;
    // 1 unit ≈ 187 km here, so EXAG× on Everest's 8,848 m is ~0.66 units of displacement.
    const lift = (8848 / 1000) * S.EXAG / (6371 / R);
    const W = GLOBE_SEG_W + 1;

    // Pass 1: height per vertex. SphereGeometry lays vertices out as a (W+1)×(H+1) UV grid,
    // so neighbours are index arithmetic and slope costs nothing.
    const hs = new Float32Array(pos.count);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const len = v.length();
      const lat = 90 - (Math.acos(v.y / len) * 180) / Math.PI;
      const lon = (Math.atan2(v.z, -v.x) * 180) / Math.PI - 180;
      const m = dem.sample(((lon + 540) % 360) - 180, lat);
      hs[i] = m !== null && m > 0 ? Math.min(1, m / 8848) : 0;
    }

    // Pass 2: displace, and shade by local slope. Same trick as the region terrain — at globe
    // scale a linear height ramp turns every continent into one flat green shape, and slope is
    // what actually makes the Andes, the Himalaya and the Rift read.
    const sea = new THREE.Color(C.globeSea);
    for (let i = 0; i < pos.count; i++) {
      const ix = i % W, iy = (i / W) | 0;
      const h = hs[i];
      v.fromBufferAttribute(pos, i);
      v.multiplyScalar((R + h * lift) / v.length());
      pos.setXYZ(i, v.x, v.y, v.z);
      if (h <= 0) { col.setXYZ(i, sea.r, sea.g, sea.b); continue; }
      const l = hs[iy * W + (ix === 0 ? W - 2 : ix - 1)];
      const r2 = hs[iy * W + (ix >= W - 1 ? 1 : ix + 1)];
      const u = hs[Math.max(0, iy - 1) * W + ix];
      const d2 = hs[Math.min(GLOBE_SEG_H, iy + 1) * W + ix];
      const slope = 1 - Math.exp(-(Math.abs(r2 - l) + Math.abs(d2 - u)) / 0.02);
      const shade = 0.72 + slope * 0.62;
      const [cr, cg, cb] = ramp(Math.pow(h, 0.42));
      col.setXYZ(i, cr * shade, cg * shade, cb * shade);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    globeGeo.computeVertexNormals();
    setSource(`globe relief · z${dem.zoom} · ${Math.round(dem.metresPerPixel)} m/px · ${S.EXAG}× vertical`, true);
    subEl.textContent = "the world · 195 countries";
  })();
}

/* ── POI layer ────────────────────────────────────────────────────────────
   The 188 researched and curated places, plus the 55 routes, drawn into their own group so a
   filter change rebuilds only this and never touches the terrain underneath it.

   Scale, in kilometres, because that is the rule: on a region view 100 units spans the region's
   long axis, so Colorado is ~6.1 km per unit. A POI dot at S.DOT*0.55 is 0.11 units ≈ 0.67 km,
   which is a place rather than a county. */
const POI_COLOUR = {
  summit: 0xf2f6ee, scramble: 0xe08b6b, climb: 0xd96b6b, trail: 0xa8cc70,
  water: 0x4f93b5, fish: 0x6fc0d0, view: 0xe3c765, paddle: 0x5fb0c7,
  snow: 0xcfe6f2, bike: 0xc08ad0, camp: 0x9ab87a, geology: 0xc9a06b,
  dark: 0x8f8fd0, food: 0xe0a06b, town: 0x86a8c4, history: 0xb0a089,
};
function poiColour(p) {
  for (const i of p.interests || []) if (POI_COLOUR[i]) return POI_COLOUR[i];
  return C.miss;
}

function buildPOIs(root, P, yAt, rows, { scale = 1 } = {}) {
  emptyGroup(root);
  if (!rows) return;

  for (const p of rows) {
    // Routes draw as lines through their resolved waypoints; anything with fewer than two
    // located waypoints has nothing to draw and is left to the list panel.
    if (p.waypoints) {
      const pts = p.waypoints.filter(w => w.lat != null)
        .map(w => { const [X, Z] = P.world(w.lon, w.lat); return new THREE.Vector3(X, yAt(w.lon, w.lat) + 0.18, Z); });
      const t = tube(pts, p.logged ? C.park : C.next, S.ROAD * 0.7 * scale, p.logged ? 0.85 : 0.5);
      if (t) {
        hoverable(t, p.name,
          [p.kind, p.nights ? p.nights + " nights" : null, p.permitTier !== "none" ? p.permitTier : null,
            p.logged ? "logged" : null].filter(Boolean).join(" · "),
          () => PANEL && focusPlace(p));
        root.add(t);
      }
      continue;
    }

    if (p.lat == null) continue;
    const [X, Z] = P.world(p.lon, p.lat);
    const y = yAt(p.lon, p.lat);
    const col = p.visited ? C.park : poiColour(p);
    const d = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({
      color: col, transparent: !p.visited, opacity: p.visited ? 1 : 0.78 }));
    d.scale.setScalar(S.DOT * (p.visited ? 0.75 : 0.55) * scale);
    d.position.set(X, y + 0.1 * scale, Z);
    hoverable(d, p.name,
      [p.cls != null ? "class " + p.cls : null,
        p.visited ? "done" : null,
        p.src === "research" || p.src === "curated" ? "editorial — check source" : null,
      ].filter(Boolean).join(" · ") || p.kind,
      () => focusPlace(p));
    root.add(d);
  }
  pruneHoverables();
}

/** Clicking a row or a pin: move the camera to it and open its card. */
function focusPlace(p) {
  if (p.lat == null) return;
  const r = regionCtx;
  if (!r) return;
  const [X, Z] = r.P.world(p.lon, p.lat);
  const y = r.yAt ? r.yAt(p.lon, p.lat) : 0;
  const target = new THREE.Vector3(X, y, Z);
  const dist = Math.max(12, framedDist * 0.28);
  ease(target.clone().add(new THREE.Vector3(0, dist * 0.72, dist * 0.69)), target, 520);
}

let regionCtx = null;   // { P, yAt } for the region currently on screen

/* ── chrome ───────────────────────────────────────────────────────────── */
const stats = r => document.getElementById("stats").innerHTML =
  r.map(x => `<div><b>${x[0]}</b><span>${x[1]}</span></div>`).join("");

const legend = r => document.getElementById("hint").innerHTML =
  r.map(s => { const [c, ...t] = s.split(" ");
    return c.startsWith("#") ? `<span style="color:${c}">${t.join(" ")}</span>` : `<span>${s}</span>`;
  }).join("<br>");

function setSource(text, good) {
  const el = document.getElementById("src");
  el.textContent = text;
  el.className = "pill" + (good ? " on" : " warn");
}

let framedDist = 0, popArmed = false, lastFrame = null;

/**
 * @param focus  optional world point to centre on. The fit still uses every corner of the
 *               scene, so passing the mainland's centre keeps Alaska and Hawaii in frame
 *               while putting the subject of the map in the middle rather than the average
 *               of the map and its insets.
 */
function frame(dirIn, pad = 1.06, focus = null) {
  lastFrame = { dir: dirIn.clone(), pad, focus: focus ? focus.clone() : null };
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return Promise.resolve();
  const centre = focus ? focus.clone() : box.getCenter(new THREE.Vector3());
  const dir = dirIn.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  const camUp = new THREE.Vector3().crossVectors(dir, right);

  // The card takes real estate — the right third on a laptop, the bottom half on a phone.
  // Fitting to the full viewport is why the region ended up half-hidden behind it. Fit to the
  // strip that is actually visible, then slide the target so the region sits in that strip.
  // Measure the panel rather than infer it from a breakpoint: it is a side panel on a laptop,
  // a bottom sheet on a phone held upright, and a side panel again the moment that phone is
  // turned sideways. A wide-as-the-window panel occludes vertically; anything else occludes
  // horizontally.
  const host = document.getElementById("cardhost");
  const open = host.classList.contains("open");
  const r = open ? host.getBoundingClientRect() : null;
  const sheet = !!r && r.width >= innerWidth * 0.9;
  const cardW = r && !sheet ? r.width : 0;
  const cardH = r && sheet ? r.height : 0;
  const visW = Math.max(240, innerWidth - cardW);
  const visH = Math.max(240, innerHeight - cardH);
  const tv0 = Math.tan((camera.fov * Math.PI) / 180 / 2);
  const th = tv0 * (visW / innerHeight);
  const tv = tv0 * (visH / innerHeight);

  // Fit the actual corners. A bounding sphere around a flat wide map over-pads badly and
  // pushes the camera into the next county.
  let dist = 0;
  const q = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    q.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z).sub(centre);
    const along = q.dot(dir);
    dist = Math.max(dist, along + Math.abs(q.dot(right)) / th, along + Math.abs(q.dot(camUp)) / tv);
  }
  dist *= pad;
  // World units per screen pixel at this distance, then nudge the target so `centre` lands in
  // the middle of the visible strip rather than the middle of the window.
  const perPx = (2 * dist * tv0) / innerHeight;
  const target = centre.clone()
    .add(right.clone().multiplyScalar((cardW / 2) * perPx))
    .sub(camUp.clone().multiplyScalar((cardH / 2) * perPx));
  framedDist = 0; popArmed = false;
  return ease(target.clone().add(dir.multiplyScalar(dist)), target).then(() => {
    framedDist = dist;
    popArmed = nav.view === "region";
  });
}

// Closing the card gives back a third of the window, so the map should come back to the middle
// rather than sitting where it was pushed to make room.
let reframeTimer = null;
function reframe() {
  if (!lastFrame) return;
  const at = token;
  clearTimeout(reframeTimer);
  reframeTimer = setTimeout(() => {
    if (at !== token || !lastFrame) return;      // a new view is building; it will frame itself
    frame(lastFrame.dir, lastFrame.pad, lastFrame.focus);
  }, 240);                                        // after the panel's slide-out finishes
}

let tw = null;
function ease(pos, tgt, ms = 620) {
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const start = performance.now();
  if (tw) cancelAnimationFrame(tw);
  return new Promise(resolve => {
    (function step() {
      const v = Math.min(1, (performance.now() - start) / ms);
      const e = 1 - (1 - v) ** 3;
      camera.position.lerpVectors(p0, pos, e);
      controls.target.lerpVectors(t0, tgt, e);
      if (v < 1) tw = requestAnimationFrame(step); else resolve();
    })();
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));
async function wipe(fn) {
  wipeEl.classList.add("on");
  await wait(190);
  await fn();
  wipeEl.classList.remove("on");
}

/* ── hover: the only label on screen is the one under the cursor ──────── */
const ray = new THREE.Raycaster(), mv = new THREE.Vector2();
const tip = document.getElementById("tip");
let hot = null, downAt = null, held = false, tipTimer = null;

// On a map, one finger should move the map. OrbitControls defaults one-finger to rotate, which
// on a phone feels like the map is fighting you. The globe is the exception — a globe is a
// thing you spin.
function setTouchMode(kind) {
  controls.touches = kind === "globe"
    ? { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }
    : { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
}

function setHot(obj) {
  if (hot === obj) return;
  if (hot?.material?.emissive) hot.material.emissive.setHex(0x000000);
  hot = obj;
  if (hot?.material?.emissive) hot.material.emissive.setHex(0x1d2a16);
}

function pick(e) {
  mv.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mv, camera);
  ray.params.Line.threshold = 0.6;
  const h = ray.intersectObjects(hoverables, false).find(o => o.object.userData?.hover);
  return h ? h.object : null;
}

addEventListener("pointermove", e => {
  if (e.target.closest?.("#cardhost, #modes, #top")) { tip.style.opacity = 0; return; }
  const o = pick(e);
  setHot(o);
  if (o) {
    const { title, sub } = o.userData.hover;
    tip.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ""}`;
    const w = tip.offsetWidth || 200, h2 = tip.offsetHeight || 40;
    tip.style.left = Math.min(innerWidth - w - 12, e.clientX + 16) + "px";
    tip.style.top = Math.min(innerHeight - h2 - 12, e.clientY + 14) + "px";
    tip.style.opacity = 1;
    cv.style.cursor = o.userData.click ? "pointer" : "crosshair";
  } else { tip.style.opacity = 0; cv.style.cursor = "grab"; }
});

cv.addEventListener("pointerdown", e => { downAt = [e.clientX, e.clientY, performance.now()]; held = true; });
addEventListener("pointerup", () => setTimeout(() => held = false, 2400));
cv.addEventListener("pointerup", e => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  const quick = performance.now() - downAt[2] < 500;
  downAt = null;
  // A finger is jitterier than a mouse, so the "this was a tap, not a drag" threshold is looser
  // on touch. Too tight and every tap on a phone reads as a pan and nothing ever opens.
  if (moved > (TOUCH ? 12 : 5) || !quick) return;
  const o = pick(e);
  if (!o) return;
  if (o.userData.click) { o.userData.click(); return; }
  // No card behind it, but there is something to say — on touch there is no hover, so a tap
  // has to double as the way to read a label.
  if (TOUCH) {
    const { title, sub } = o.userData.hover;
    tip.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ""}`;
    tip.style.left = Math.min(innerWidth - 220, e.clientX + 12) + "px";
    tip.style.top = Math.max(60, e.clientY - 64) + "px";
    tip.style.opacity = 1;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { tip.style.opacity = 0; }, 2200);
  }
});

addEventListener("keydown", e => {
  if (e.key === "Escape") { if (nav.view === "region") back(); else closeCard(); }
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "1") go("co");
  if (e.key === "2") go("us");
  if (e.key === "3") go("globe");
});

/* ── navigation ───────────────────────────────────────────────────────── */
// A breadcrumb rather than one back button. "GLOBE › UNITED STATES › COLORADO" tells you where
// you are as well as how to leave, and every segment is clickable.
function setCrumbs(items) {
  backEl.innerHTML = "";
  if (items.length < 2) { backEl.classList.remove("on"); return; }
  items.forEach((it, i) => {
    if (i) backEl.appendChild(Object.assign(document.createElement("span"), { className: "sep", textContent: "›" }));
    const b = document.createElement("button");
    b.textContent = it.label;
    b.className = i === items.length - 1 ? "here" : "";
    if (it.go) b.addEventListener("click", it.go);
    backEl.appendChild(b);
  });
  backEl.classList.add("on");
}

function modeButtons(active) {
  document.querySelectorAll("#modes button").forEach(b => b.classList.toggle("on", b.dataset.m === active));
}

// Countries big enough — or well enough mapped — to browse a piece at a time rather than as
// one slab. Only the US has a verified subdivision dataset in this stack (us-atlas states);
// world-atlas is country-level at every resolution. Add entries here as datasets are verified.
const SUBDIVIDED = {
  "United States": () => go("us"),
};

async function drillState(code, forceParent) {
  const meta = STATE[code];
  const feature = STATES.find(f => ABBR[f.name] === code);
  if (!feature) return fail("no polygon for " + code);
  const parent = forceParent || (nav.view === "region" ? nav.parent : nav.view);
  nav = { view: "region", parent, spec: { code, title: meta?.name || code } };
  setCrumbs([
    parent === "globe"
      ? { label: "Globe", go: () => go("globe") }
      : { label: "USA", go: () => go("us") },
    { label: meta?.name || code },
  ]);
  modeButtons(code === "CO" ? "co" : null);
  await wipe(async () => {
    openState(code, cardCtx());          // open first so the camera can frame around it
    await buildRegion({ feature, code, title: meta?.name || code });
  });
}

async function drillCountry(rawName) {
  const name = canonCountry(rawName);
  if (SUBDIVIDED[name]) return SUBDIVIDED[name]();
  const feature = (WORLD50 || WORLD).find(f => f.name === name);
  if (!feature) return fail("no polygon for " + name);
  nav = { view: "region", parent: "globe", spec: { country: name, title: name } };
  setCrumbs([{ label: "Globe", go: () => go("globe") }, { label: name }]);
  modeButtons(null);
  await wipe(async () => {
    openCountry(name, cardCtx());
    await buildRegion({ feature, country: name, title: name });
  });
}

function back() {
  closeCard();
  go(nav.parent || "us");
}

function go(m) {
  errEl.textContent = "";
  closeCard();
  setCrumbs([]);
  popArmed = false;
  regionCtx = null;
  PANEL?.setRegion(null);
  if (m === "co") { drillState("CO", "us"); return; }
  nav = { view: m };
  modeButtons(m);
  subEl.textContent = m === "us" ? "united states · 63 parks · 51 states" : "the world · 195 countries";
  wipe(async () => {
    try { m === "us" ? await buildUS() : await buildGlobe(); }
    catch (e) { fail(e); }
  });
}

/* ── loop ─────────────────────────────────────────────────────────────── */
const t0 = performance.now();
(function loop() {
  requestAnimationFrame(loop);
  const t = (performance.now() - t0) / 1000;
  if (nav.view === "globe" && !held) group.rotation.y += 0.00026;
  // Zoom out far enough and you leave. This is how a map is supposed to behave, and it means
  // going back never depends on noticing a chip in the corner.
  if (popArmed && nav.view === "region" &&
      camera.position.distanceTo(controls.target) > framedDist * 2.15) {
    popArmed = false;
    back();
  }
  for (const g of pulses) {
    const r = g.userData.ring;
    if (r) r.material.opacity = 0.2 + 0.13 * (1 + Math.sin(t * 1.5 + g.position.x * 0.25));
  }
  controls.update();
  renderer.render(scene, camera);
})();

/* ── static geography ─────────────────────────────────────────────────── */
const CO_RIVERS = [
  [[40.45, -105.9], [40.20, -106.35], [39.90, -106.42], [39.60, -106.85], [39.50, -107.32], [39.20, -108.05], [39.06, -108.55], [39.02, -109.03]],
  [[39.15, -106.30], [38.90, -106.10], [38.70, -105.90], [38.45, -105.20], [38.26, -104.61], [38.10, -103.60], [38.05, -102.10]],
  [[37.85, -106.35], [37.60, -105.95], [37.35, -105.75], [37.05, -105.70]],
  [[40.60, -105.55], [40.45, -105.00], [40.40, -104.30], [40.55, -103.60], [40.68, -102.10]],
  [[37.70, -107.60], [37.40, -107.75], [37.15, -107.88], [36.99, -108.00]],
  [[40.55, -106.85], [40.35, -107.30], [40.20, -107.80], [40.05, -108.40]],
];
const RIVERS = [
  [[47.9, -95.0], [45.0, -93.2], [43.5, -91.2], [41.5, -90.6], [38.6, -90.2], [36.5, -89.5], [35.1, -90.1], [32.3, -90.9], [31.0, -91.4], [29.9, -90.1], [29.2, -89.3]],
  [[43.0, -110.0], [41.5, -109.5], [40.0, -110.2], [38.4, -109.6], [37.9, -111.0], [36.9, -111.5], [36.1, -112.1], [36.0, -114.0], [34.7, -114.5], [32.7, -114.6]],
  [[47.7, -115.5], [46.7, -117.0], [46.2, -119.0], [45.7, -120.7], [45.6, -121.9], [46.2, -123.9]],
  [[47.5, -111.3], [46.5, -104.0], [44.4, -100.4], [42.9, -97.4], [40.7, -95.9], [39.1, -94.6], [38.6, -90.2]],
  [[39.1, -106.3], [38.5, -105.2], [38.2, -104.6], [38.0, -102.2], [37.7, -99.0], [36.1, -95.9], [35.0, -91.2], [33.9, -91.1]],
  [[44.5, -74.0], [43.3, -73.8], [42.7, -73.7], [41.5, -73.9], [40.7, -74.0]],
];

/* ── init ─────────────────────────────────────────────────────────────── */
document.getElementById("build").textContent = BUILD;
mountCard(document.getElementById("cardhost"), reframe);
document.querySelectorAll("#modes button")
  .forEach(b => b.addEventListener("click", () => go(b.dataset.m)));

(async function init() {
  resize();
  try {
    const [d, us, w] = await Promise.all([
      fetch("./travel.json?" + Date.now()).then(r => r.json()),
      fetch("https://unpkg.com/us-atlas@3/states-10m.json").then(r => r.json()),
      fetch("https://unpkg.com/world-atlas@2/countries-110m.json").then(r => r.json()),
    ]);
    DATA = d;
    STATES = decodeTopo(us, "states");
    WORLD = canonNames(decodeTopo(w, "countries"));
    store.init(DATA);
    buildIndexes();
    warnUnmatchedCountries();

    // The merged index over parks, her own record, curated gems, research and routes.
    INDEX = buildPlaces(DATA);
    PROGRESS = evaluate(DATA, INDEX);
    const audit = auditPlaces(INDEX);
    const errs = audit.filter(a => a.level === "error");
    if (errs.length) console.error("[atlast] place index errors:", errs);
    console.log("[atlast] index:", INDEX.places.length, "places,", INDEX.routes.length, "routes,",
      INDEX.unresolved.length, "awaiting coordinates ·", PROGRESS.earned.length, "badges earned");

    PANEL = mountPanel(document.getElementById("panel"), {
      index: INDEX,
      suggestions: suggestNext(DATA, INDEX, PROGRESS),
      // A filter change repaints only the POI group; terrain and markers are untouched.
      onFilter: rows => {
        poiFilter = rows;
        if (regionCtx && poiRootRef) buildPOIs(poiRootRef, regionCtx.P, regionCtx.yAt, rows, { scale: 0.9 });
      },
      onFocus: p => focusPlace(p),
      // One tap, no date — Letterboxd's eye. The dated entry is a separate action.
      onLog: async p => {
        const patch = markDone(DATA, p);
        Object.assign(DATA, Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)));
        INDEX = buildPlaces(DATA);
        PROGRESS = evaluate(DATA, INDEX);
        const tier = await store.savePatch(patch);
        PANEL.apply();

    // The panel slides out of the way; it is a tool, not furniture.
    const panelEl = document.getElementById("panel");
    document.getElementById("paneltog").addEventListener("click", () => {
      panelEl.classList.toggle("open");
      reframe();
    });
        // Repaint the pins in place rather than rebuilding the region — the terrain is
        // expensive and has not changed just because one dot turned green.
        if (regionCtx && poiRootRef) buildPOIs(poiRootRef, regionCtx.P, regionCtx.yAt, poiFilter, { scale: 0.9 });
        subEl.textContent = tier === "live"
          ? `logged ${p.name} → travel.json`
          : `logged ${p.name} — cached in this browser`;
      },
    });
    PANEL.apply();
    console.log("[atlast]", BUILD, "states", STATES.length, "countries", WORLD.length,
      "cities placed", cityState.size);
    go("us");
    document.getElementById("load").remove();
    // Finer country outlines for the globe and for drilling into a country. 756 kB, so it
    // arrives after the app is already usable rather than holding up first paint.
    fetch("https://unpkg.com/world-atlas@2/countries-50m.json")
      .then(r => r.json())
      .then(j => {
        WORLD50 = canonNames(decodeTopo(j, "countries"));
        // Re-resolve city→country against the finer outlines so the globe and the country
        // cards cannot disagree about which border a city sits inside.
        for (const city of DATA.cities) {
          for (const f of WORLD50) {
            if (inside(city.lon, city.lat, f.rings)) { cityCountry.set(city.name, f.name); break; }
          }
        }
        console.log("[atlast] 50m outlines ready");
      })
      .catch(() => console.warn("[atlast] 50m outlines unavailable, staying on 110m"));
  } catch (e) {
    fail("data load failed — " + (e.message || e));
    document.getElementById("load")?.remove();
  }
})();
