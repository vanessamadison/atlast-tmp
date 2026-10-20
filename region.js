// Geometry for a region — one state, one country, or the whole mainland.
//
// This exists so there is exactly one implementation of "extruded slab with real terrain
// clipped to a real border". Colorado used to be a bespoke 100-line block inside the view
// code; now Colorado, Texas, Peru and Japan all come out of the same two functions, and
// Colorado is only special in which markers get layered on top of it.
//
// Nothing here knows about travel.json. It takes a decoded TopoJSON feature, a projector and
// an elevation sampler, and returns meshes.

import * as THREE from "three";
import { decimate } from "./geo.js?v=14";
import { C, ramp } from "./style.js?v=14";
import { M_TO_FT } from "./dem.js?v=14";

/**
 * A projector for one region.
 * @param project  (lon,lat) => [x,y] with y northward — albers() or laea()
 * @param feats    features whose rings define the extent
 * @param span     width in scene units the long axis should occupy
 */
export function projectorFor(project, box, span) {
  const [x0, y0, x1, y1] = box;
  const k = span / Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // flat: the (X,Y) a THREE.Shape is built in, Y northward.
  const flat = (lon, lat) => { const [x, y] = project(lon, lat); return [(x - cx) * k, (y - cy) * k]; };
  // world: the (X,Z) a marker sits at, after -90° about X sends shape-Y to world -Z.
  const world = (lon, lat) => { const [X, Y] = flat(lon, lat); return [X, -Y]; };
  return { flat, world, k, box, project };
}

/**
 * The plinth. Extruded from the real border, so the region floats on something instead of
 * floating in nothing. ExtrudeGeometry runs 0 → depth along +Z, and the -90° rotation about
 * X sends that to world +Y — so the top face lands at y = depth and terrain stacks from there.
 */
export function slabGroup(feature, P, opts = {}) {
  const {
    depth = 1, cap = C.landOff, side = C.slabSide,
    edge = C.edgeOff, edgeOpacity = 0.5, capOpacity = 1,
  } = opts;
  const g = new THREE.Group();
  for (const ring of feature.rings) {
    if (ring.length < 3) continue;
    const sh = new THREE.Shape();
    ring.forEach(([lo, la], i) => { const [X, Y] = P.flat(lo, la); i ? sh.lineTo(X, Y) : sh.moveTo(X, Y); });
    const capMat = new THREE.MeshStandardMaterial({
      color: cap, roughness: 0.92, metalness: 0.03, side: THREE.DoubleSide,
      transparent: capOpacity < 1, opacity: capOpacity });
    const sideMat = new THREE.MeshStandardMaterial({
      color: side, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const m = new THREE.Mesh(
      new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }), [capMat, sideMat]);
    m.rotation.x = -Math.PI / 2;
    m.userData.baseColour = cap;
    g.add(m);

    const e = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.ShapeGeometry(sh)),
      new THREE.LineBasicMaterial({ color: edge, transparent: true, opacity: edgeOpacity }));
    e.rotation.x = -Math.PI / 2;
    e.position.y = depth + 0.01;
    g.add(e);
  }
  return g;
}

/** Border drawn at terrain height rather than slab height, so it hugs the relief. */
export function borderLine(feature, P, yAt, colour, opacity = 0.7, lift = 0.08) {
  const g = new THREE.Group();
  for (const ring of feature.rings) {
    if (ring.length < 2) continue;
    g.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ring.map(([lo, la]) =>
        new THREE.Vector3(P.world(lo, la)[0], yAt(lo, la) + lift, P.world(lo, la)[1]))),
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity })));
  }
  return g;
}

/**
 * Terrain, clipped to the real border by point-in-polygon.
 *
 * Colorado is rectangular in lat/lon but not in projected space — Albers converges the
 * meridians, so the north edge is genuinely shorter. Every region has this problem. The grid
 * is built in lon/lat and each cell is kept only if its centre falls inside the real polygon,
 * which is the only thing that produces a correct silhouette.
 *
 * @param cells   approximate triangle-pair budget; the grid is shaped to the region's aspect
 * @param ftAt    (lon,lat) => feet. Caller decides DEM versus procedural and counts the split.
 * @param base    world y the terrain sits on — the top of the slab
 * @param relief  world units the full eMin→eMax range should occupy
 * @param tint    [r,g,b] multiplier over the elevation ramp, for the visited/not language
 */
export function terrainMesh(feature, P, opts) {
  const {
    bounds, ftAt, base = 0, relief = 6, eMin = 0, eMax = 14440,
    cells = 90000, tint = [1, 1, 1], flatSea = true,
  } = opts;
  const [south, north, west, east] = bounds;

  // Shape the grid to THIS feature, not to the layer. P.box is the whole layer's extent, so
  // using it would hand Florida a grid shaped like the contiguous United States.
  const corners = [[west, south], [east, south], [west, north], [east, north]].map(([lo, la]) => P.flat(lo, la));
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
  const fw = Math.max(...xs) - Math.min(...xs), fh = Math.max(...ys) - Math.min(...ys);
  const aspect = Math.max(0.12, Math.min(8, fw / Math.max(1e-9, fh)));
  const NX = Math.max(24, Math.round(Math.sqrt(cells * aspect)));
  const NY = Math.max(24, Math.round(cells / NX));

  // Scanline costs rows × edges rather than cells × edges, so the border can carry far more
  // detail than it could when every cell paid for every vertex. Coastlines look like coastlines.
  const clip = decimate(feature.rings, 700);
  const rel = ft => ((Math.min(eMax, Math.max(eMin, ft)) - eMin) / (eMax - eMin)) * relief;
  const W = NX + 1, H = NY + 1;

  const pos = new Float32Array(W * H * 3);
  const col = new Float32Array(W * H * 3);
  const hft = new Float32Array(W * H);        // raw feet, kept for the slope pass
  const gi = (i, j) => j * W + i;

  for (let j = 0; j < H; j++) {
    const la = north - (north - south) * (j / NY);
    for (let i = 0; i < W; i++) {
      const lo = west + (east - west) * (i / NX);
      const [X, Z] = P.world(lo, la);
      const ft = ftAt(lo, la);
      const k = gi(i, j);
      hft[k] = ft;
      pos[k * 3] = X;
      pos[k * 3 + 1] = base + rel(flatSea && ft <= 0 ? 0 : ft);
      pos[k * 3 + 2] = Z;
    }
  }

  // Colour in a second pass so slope can be measured from finished neighbours.
  //
  // Two things happen here, and both exist because the eastern United States is real
  // topography that a linear ramp keyed to Mount Whitney renders as one flat green sheet.
  //   1. the elevation ramp is compressed (t^0.55), spending more of its range down low
  //   2. brightness responds to LOCAL SLOPE, which is scale-free — the Appalachians, the
  //      Driftless and the Ozarks read as ridges even though they are a rounding error
  //      against a 14,000 ft ceiling
  // Neither touches geometry. Height stays honest at exactly S.EXAG; this is shading.
  const span = Math.max(1, eMax - eMin);
  const gScale = span / 45;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = gi(i, j);
      const hx = hft[gi(Math.min(NX, i + 1), j)] - hft[gi(Math.max(0, i - 1), j)];
      const hy = hft[gi(i, Math.min(NY, j + 1))] - hft[gi(i, Math.max(0, j - 1))];
      const slope = 1 - Math.exp(-(Math.abs(hx) + Math.abs(hy)) / gScale);
      const shade = 0.80 + slope * 0.55;
      const t = Math.min(1, Math.max(0, (hft[k] - eMin) / span));
      const [r, g, b] = ramp(Math.pow(t, 0.55));
      col[k * 3] = r * tint[0] * shade;
      col[k * 3 + 1] = g * tint[1] * shade;
      col[k * 3 + 2] = b * tint[2] * shade;
    }
  }

  // Scanline span fill instead of point-in-polygon per cell. Identical even-odd result;
  // the work drops from cells×edges to rows×edges, which is what pays for the resolution.
  const idx = new Uint32Array(NX * NY * 6);
  let n = 0;
  const cross = [];
  for (let j = 0; j < NY; j++) {
    const la = north - (north - south) * ((j + 0.5) / NY);
    cross.length = 0;
    for (const r of clip) {
      for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
        const yi = r[a][1], yj = r[b][1];
        if ((yi > la) !== (yj > la)) {
          cross.push(r[a][0] + ((la - yi) / (yj - yi)) * (r[b][0] - r[a][0]));
        }
      }
    }
    if (cross.length < 2) continue;
    cross.sort((p, q) => p - q);
    for (let s = 0; s + 1 < cross.length; s += 2) {
      const i0 = Math.max(0, Math.ceil(((cross[s] - west) / (east - west)) * NX - 0.5));
      const i1 = Math.min(NX - 1, Math.floor(((cross[s + 1] - west) / (east - west)) * NX - 0.5));
      for (let i = i0; i <= i1; i++) {
        idx[n++] = gi(i, j);     idx[n++] = gi(i + 1, j + 1); idx[n++] = gi(i + 1, j);
        idx[n++] = gi(i, j);     idx[n++] = gi(i, j + 1);     idx[n++] = gi(i + 1, j + 1);
      }
    }
  }
  if (!n) return null;

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, n), 1));
  g.computeVertexNormals();
  // DoubleSide is insurance: -90° about X keeps the normal up, +90° flips it and FrontSide
  // culling then deletes the entire terrain with no error at all.
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.94, metalness: 0.02, side: THREE.DoubleSide }));
  mesh.userData.grid = { NX, NY, bounds };
  return mesh;
}

/** Elevation sampler that prefers the DEM and falls back, counting the split honestly. */
export function sampler(dem, fallback) {
  const s = { dem: 0, proc: 0 };
  const fn = (lon, lat) => {
    if (dem) {
      const m = dem.sample(lon, lat);
      if (m !== null && Number.isFinite(m)) { s.dem++; return m * M_TO_FT; }
    }
    s.proc++;
    return fallback(lon, lat);
  };
  fn.stats = s;
  fn.share = () => (s.dem + s.proc ? s.dem / (s.dem + s.proc) : 0);
  return fn;
}
