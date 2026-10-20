#!/usr/bin/env bash
# ATLAST — local server.
#
# Two jobs beyond serving files:
#   1. no-cache headers, so an ES module can never go stale on you. Static imports are cached
#      by URL and a hard reload does not evict them, which once produced a phantom "does not
#      provide an export named 'inside'" for an export that was right there.
#   2. POST /__save, which merges the card's editable fields back into travel.json on disk.
#      That is what makes the priority field genuinely persist rather than sit in localStorage.
cd "$(dirname "$0")" || exit 1
echo "ATLAST → http://localhost:8080   (no-cache · travel.json is writable)"
python3 - <<'PY'
import http.server, socketserver, json, os, sys

ROOT = os.getcwd()
DATA = os.path.join(ROOT, "travel.json")

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_POST(self):
        if self.path.split("?")[0] != "/__save":
            self.send_error(404); return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            patch = json.loads(self.rfile.read(n) or b"{}")
            with open(DATA, "r", encoding="utf-8") as f:
                doc = json.load(f)
            # Only the keys the app is allowed to own. Everything else in travel.json is hers
            # to edit by hand and must survive untouched.
            for key in ("stateNotes", "visits", "trips", "routesLogged",
                        "fourteeners", "parksVisited", "coTowns", "cities",
                        "statesVisited", "countriesVisited", "updated"):
                if key in patch:
                    doc[key] = patch[key]
            tmp = DATA + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(doc, f, indent=2, ensure_ascii=False)
                f.write("\n")
            os.replace(tmp, DATA)
            body = json.dumps({"ok": True, "wrote": os.path.basename(DATA)}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            print("saved stateNotes ->", DATA, file=sys.stderr)
        except Exception as e:
            self.send_error(500, str(e))

    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", 8080), H) as s:
    print("serving. ctrl-c to stop.")
    s.serve_forever()
PY
