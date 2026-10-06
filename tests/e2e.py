#!/usr/bin/env python3
"""Teste ponta a ponta do demo (Playwright + Chromium). Uso: python3 tests/e2e.py [pasta_de_screenshots]"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "tests" / "shots"
OUT.mkdir(parents=True, exist_ok=True)
errors, failures = [], []


def check(cond, msg):
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        failures.append(msg)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 860})
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto((ROOT / "dist/demo.html").as_uri())
    pg.wait_for_selector("path.gm-shape")

    print("Visão Brasil")
    check(pg.locator("path.gm-shape").count() == 27, "27 estados renderizados")
    check(pg.locator("text.gm-label").count() == 27, "27 siglas de UF")
    pg.screenshot(path=str(OUT / "1_brasil.png"))

    print("Drill-down para o CE")
    pg.locator('path.gm-shape[data-id="CE"]').click()
    pg.wait_for_function("window.__map.view.view === 'CE'")
    check(pg.locator("path.gm-shape").count() == 184, "184 municípios do Ceará")
    check("CE" in pg.inner_text("#crumb"), "breadcrumb mostra CE")
    pg.screenshot(path=str(OUT / "2_ce.png"))

    print("Seleção de município (Fortaleza 2304400)")
    pg.locator('path.gm-shape[data-id="2304400"]').click()
    pg.wait_for_timeout(500)
    check("Fortaleza" in pg.inner_text("#side"), "painel mostra Fortaleza")
    check(pg.locator("path.gm-hl-sel").get_attribute("d") is not None, "contorno de seleção desenhado")
    pg.screenshot(path=str(OUT / "3_municipio.png"))

    print("Zoom / pan")
    k0 = pg.evaluate("window.__map.t.k")
    pg.mouse.move(500, 450)
    pg.mouse.wheel(0, -400)
    pg.wait_for_timeout(200)
    k1 = pg.evaluate("window.__map.t.k")
    check(k1 > k0, f"roda do mouse aumenta zoom ({k0:.2f} → {k1:.2f})")
    x0 = pg.evaluate("window.__map.t.x")
    pg.mouse.move(500, 450); pg.mouse.down(); pg.mouse.move(430, 410, steps=6); pg.mouse.up()
    x1 = pg.evaluate("window.__map.t.x")
    check(abs(x1 - x0) > 1, "arrastar move o mapa")
    check(pg.evaluate("window.__map.view.view") == "CE" and pg.evaluate("window.__map.selected") in (None, "2304400", ""), "arrasto não dispara clique")
    pg.click('button[title="Redefinir zoom"]')
    pg.wait_for_timeout(500)
    check(abs(pg.evaluate("window.__map.t.k") - 1) < 1e-3, "botão redefinir volta ao zoom 1")

    print("Métricas")
    for m in ["clientes", "sla", "tickets", "tecnologia"]:
        pg.select_option("#metric", m)
        pg.wait_for_timeout(350)
        colors = pg.evaluate("[...new Set([...document.querySelectorAll('path.gm-shape')].map(p => p.getAttribute('fill')))].length")
        check(colors >= 2, f"métrica {m}: {colors} cores distintas")
    pg.screenshot(path=str(OUT / "4_categoria.png"))
    pg.select_option("#metric", "circuitos")

    print("Pontos")
    pg.check("#pts")
    pg.wait_for_timeout(600)
    n = pg.locator("circle.gm-pt").count()
    check(n > 100, f"{n} pontos desenhados dentro dos municípios")
    pg.screenshot(path=str(OUT / "5_pontos.png"))
    pg.uncheck("#pts")

    print("Busca")
    pg.fill("#q", "Sobral")
    pg.wait_for_timeout(200)
    opts = pg.evaluate("[...document.querySelectorAll('#dl option')].map(o => o.value)")
    check(any(o.startswith("Sobral") for o in opts), f"autocomplete encontra Sobral ({len(opts)} opções)")
    pg.evaluate("document.querySelector('#q').value = 'Sobral — CE'; document.querySelector('#q').dispatchEvent(new Event('change'))")
    pg.wait_for_timeout(700)
    check("Sobral" in pg.inner_text("#side"), "busca seleciona o município")

    print("Voltar ao Brasil + outra UF grande (MG)")
    pg.click("#crumb button")
    pg.wait_for_function("window.__map.view.view === 'BR'")
    pg.locator('path.gm-shape[data-id="MG"]').click()
    pg.wait_for_function("window.__map.view.view === 'MG'")
    check(pg.locator("path.gm-shape").count() == 853, "853 municípios de Minas Gerais")

    print("Tema escuro")
    pg.emulate_media(color_scheme="dark")
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / "6_dark.png"))

    print("Mobile")
    pg.emulate_media(color_scheme="light")
    pg.set_viewport_size({"width": 390, "height": 800})
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / "7_mobile.png"))
    b.close()

print("\nErros de console/página:", errors or "nenhum")
check(not errors, "sem erros de JS")
print("\nRESULTADO:", "FALHOU" if failures else "tudo ok")
sys.exit(1 if failures else 0)
