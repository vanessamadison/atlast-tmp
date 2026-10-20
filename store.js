// Editable fields, persisted honestly.
//
// A static page cannot write to disk. So there are two tiers and the UI always says which one
// it is on, rather than pretending an edit was saved when it was only cached:
//
//   LIVE   — served by serve.sh, which accepts POST /__save and rewrites travel.json in place.
//            The edit is in the file. Commit it and it is permanent.
//   CACHED — GitHub Pages, or serve.sh not running. The edit goes to localStorage for this
//            browser only, and the card offers a download of the merged travel.json.
//
// Shape written into travel.json:
//   "stateNotes": { "CO": { "priority": 5, "first": "Jun 2026", "note": "home" } }
// priority is 0–5. 0 means unset.

const LS_KEY = "atlast.stateNotes.v1";
const LS_PATCH = "atlast.travel.v1";
const LS_MAPKEY = "atlast.googleMapsKey.v1";

export const store = {
  mode: "cached",      // "live" once a save round-trips
  probed: false,
  notes: {},
  base: null,          // the travel.json object as loaded

  init(data) {
    this.base = data;
    const fromFile = data.stateNotes || {};
    let cached = {};
    try { cached = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { cached = {}; }
    // File wins on first load only for keys the cache has never touched; the cache is the
    // more recent edit by definition, so it takes precedence on conflict.
    this.notes = { ...fromFile, ...cached };
    return this.notes;
  },

  get(code) {
    return this.notes[code] || { priority: 0, first: "", note: "" };
  },

  async set(code, patch) {
    const next = { ...this.get(code), ...patch };
    if (!next.priority && !next.first && !next.note) delete this.notes[code];
    else this.notes[code] = next;
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.notes)); } catch {}
    return this.push();
  },

  // Try the local writer. One failure flips to cached and stops retrying every keystroke.
  async push() {
    if (this.mode === "cached" && this.probed) return "cached";
    try {
      const r = await fetch("./__save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateNotes: this.notes }),
      });
      this.probed = true;
      if (!r.ok) { this.mode = "cached"; return "cached"; }
      this.mode = "live";
      return "live";
    } catch {
      this.probed = true; this.mode = "cached";
      return "cached";
    }
  },

  /**
   * Write arbitrary top-level travel.json keys — what the capture system produces.
   * Same two tiers as the notes: the local writer if serve.sh is running, otherwise a
   * localStorage overlay plus the download button, and it always says which.
   */
  async savePatch(patch) {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null));
    if (!Object.keys(clean).length) return this.mode;
    Object.assign(this.base, clean);
    try { localStorage.setItem(LS_PATCH, JSON.stringify(this.base)); } catch {}
    try {
      const r = await fetch("./__save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clean),
      });
      this.probed = true;
      this.mode = r.ok ? "live" : "cached";
      return this.mode;
    } catch {
      this.probed = true; this.mode = "cached";
      return "cached";
    }
  },

  // The merged file, for the download button on Pages.
  merged() {
    const out = { ...this.base };
    out.stateNotes = this.notes;
    out.updated = new Date().toISOString().slice(0, 10);
    return JSON.stringify(out, null, 2);
  },

  download() {
    const b = new Blob([this.merged()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "travel.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },

  // Google Maps key for the Street View panorama. Kept in localStorage rather than in
  // travel.json so it never lands in a commit. travel.json is still read as a fallback
  // in case she would rather have it in the file — restrict it by HTTP referrer if so.
  mapsKey() {
    try {
      return localStorage.getItem(LS_MAPKEY) || (this.base && this.base.googleMapsKey) || "";
    } catch { return (this.base && this.base.googleMapsKey) || ""; }
  },
  setMapsKey(k) {
    try { k ? localStorage.setItem(LS_MAPKEY, k.trim()) : localStorage.removeItem(LS_MAPKEY); } catch {}
  },
};
