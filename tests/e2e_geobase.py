#!/usr/bin/env python3
"""Testa o modo geoBase (fetch sob demanda) com demo/exemplo-minimo.html servido por HTTP local."""
import functools
import http.server
import sys
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
handler.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"

errors, fails, reqs = [], [], []
def check(c, m):
    print(("  OK   " if c else "  FAIL ") + m)
    if not c: fails.append(m)

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1200, "height": 800})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("request", lambda r: reqs.append(r.url) if "/data/geo/" in r.url else None)
    pg.goto(f"{base}/demo/exemplo-minimo.html")
    pg.wait_for_selector("path.gm-shape")
    check(pg.locator("path.gm-shape").count() == 27, "visão Brasil carregada via fetch")
    check(len(reqs) == 1 and reqs[0].endswith("/brasil.json"), "baixou só brasil.json no início")
    pg.locator('path.gm-shape[data-id="CE"]').click()
    pg.wait_for_function("document.querySelectorAll('path.gm-shape').length === 184")
    check(any(u.endswith("/uf/CE.json") for u in reqs) and len(reqs) == 2, "baixou só uf/CE.json ao abrir o Ceará")
    painted = pg.evaluate("[...document.querySelectorAll('path.gm-shape:not(.gm-nd)')].map(p => p.dataset.id).sort()")
    check(painted == ["2303709", "2304400", "2307304", "2312908"], f"só os 4 municípios com dados coloridos: {painted}")
    b.close()
srv.shutdown()
check(not errors, f"sem erros de JS ({errors or 'nenhum'})")
print("RESULTADO:", "FALHOU" if fails else "tudo ok")
sys.exit(1 if fails else 0)
