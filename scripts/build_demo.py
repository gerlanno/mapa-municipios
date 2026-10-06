#!/usr/bin/env python3
"""Gera dist/demo.html (arquivo único, abre com duplo clique — sem servidor) e copia a lib p/ dist/."""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
read = lambda p: (ROOT / p).read_text(encoding="utf-8")

geo = json.dumps(json.loads(read("data/geo/bundle.json")), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
html = (
    read("demo/template.html")
    .replace("/*__CSS_LIB__*/", read("src/giga-map.css"))
    .replace("/*__CSS_DEMO__*/", read("demo/demo.css"))
    .replace("/*__JS_LIB__*/", read("src/giga-map.js").replace("</script", "<\\/script"))
    .replace("/*__JS_DEMO__*/", read("demo/demo.js").replace("</script", "<\\/script"))
    .replace("/*__GEO__*/", geo)
)
(ROOT / "dist").mkdir(exist_ok=True)
(ROOT / "dist/demo.html").write_text(html, encoding="utf-8")
shutil.copy(ROOT / "src/giga-map.js", ROOT / "dist/giga-map.js")
shutil.copy(ROOT / "src/giga-map.css", ROOT / "dist/giga-map.css")
print(f"dist/demo.html: {len(html)/1e6:.2f} MB")
