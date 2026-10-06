# mapa-municipios-br

Mapa coroplético do Brasil por **UF e município**, em SVG puro e sem dependências, pronto para plotar qualquer métrica por código IBGE — circuitos, clientes, SLA estourado, tickets, tecnologia predominante. Pensado para a distribuição de circuitos da Giga+.

Inspirado na arquitetura do mapa do apuracaoeleitoral.com (SVG + chave IBGE + painel lateral), mas **reconstruído do zero a partir da malha municipal do IBGE**. Nenhuma geometria ou código do site foi copiado.

```
dist/demo.html     ← abra com duplo clique (arquivo único, 2,6 MB, sem servidor)
```

## Início rápido

```bash
# ver o demo (dados fictícios): só abrir o arquivo
open dist/demo.html

# usar a lib em outra página (precisa de servidor HTTP p/ o fetch das geometrias)
python3 -m http.server 8080      # e abrir http://localhost:8080/demo/exemplo-minimo.html
```

```html
<link rel="stylesheet" href="src/giga-map.css">
<div id="mapa" style="height:80vh"></div>
<script src="src/giga-map.js"></script>
<script>
  const map = new GigaMap('#mapa', { geoBase: 'data/geo', metric: { label: 'Circuitos' } });
  map.setData({ '2304400': 1200, '2303709': { value: 340, clientes: 41 } });   // chave = código IBGE
  map.on('select', info => console.log(info));                                // {id, nome, uf, value, raw…}
</script>
```

## O que tem no repositório

| Caminho | Conteúdo |
|---|---|
| `src/giga-map.js`, `src/giga-map.css` | A biblioteca (≈ 28 KB, sem dependências). |
| `data/geo/brasil.json`, `data/geo/uf/XX.json` | Geometrias prontas: 27 estados + municípios de cada UF, já em *SVG path*. |
| `data/geo/bundle.json` | Tudo junto (usado pelo demo standalone). |
| `data/dim_municipio.csv` | Dimensão para o BI: código IBGE, nome, UF, meso/microrregião, lat/lon, área aprox. (separador `;`, decimal `,`). |
| `export/geojson/`, `export/topojson/` | Mesmas geometrias em GeoJSON (lon/lat) e TopoJSON — QGIS, Shape Map, Deneb, D3. |
| `dist/demo.html` | Demo completo: troca de métrica, busca, ranking, painel, pontos, tema escuro, mobile. |
| `scripts/` | `build_geo.py` (gera as geometrias), `build_demo.py`, `export_topojson.mjs`, `fetch_source.sh`. |
| `tests/` | Unitários (geometria, projeção, parser IBGE) e ponta a ponta com Chromium. |
| `docs/POWERBI.md` | Caminhos para levar o mapa ao Power BI. |

## Como funciona

1. **Geometria**: cada município é um `<path>` com `data-id` = código IBGE (7 dígitos). Projeção equiretangular com correção de cos(lat), coordenadas normalizadas num `viewBox` de até 1000 unidades.
2. **Cor**: o `fill` vem de uma tabela `{codigo_ibge: valor}`. Escala por quantis (padrão), linear, raiz ou log; ou modo categórico (cor por categoria).
3. **Agregação**: na visão Brasil os valores dos municípios são agregados por UF (`sum`, `mean`, `max`, `count` ou função própria — útil p/ média ponderada de SLA).
4. **Interação**: roda do mouse, arrastar, pinça no celular, botões +/−/reset, hover com tooltip, clique para selecionar, drill-down Brasil → UF, navegação por teclado.
5. **Pontos**: `addPoints([{lat, lon}])` desenha circuitos individuais usando a **mesma projeção** do mapa, então caem no lugar certo.

## API

```js
new GigaMap(el, {
  geo | geoBase,            // geometria embutida (bundle.json) ou pasta com brasil.json + uf/XX.json
  metric: { label, ramp: 'blue'|'heat'|'green'|'purple'|[cores], scale: 'quantile'|'linear'|'sqrt'|'log',
            aggregate, format, domain: [min,max] },
  mode: 'heat' | 'category', categories: { chave: { label, color } },
  tooltip: info => string|Node, theme: 'light'|'dark', labels, legend, controls, drillOnClick
})
map.setData({ ibge: número | { value, category, ...extras } }, metric?)
map.setMetric({...})                          // troca escala/rótulo sem trocar dados
map.showBrasil() / map.showUF('CE')           // retornam Promise
map.select(id, { zoom: true }) / clearSelection() / zoomTo(id) / zoomBy(f) / resetZoom()
map.addPoints(pts, { radius, color, opacity, sizeBy }) / clearPoints() / project(lon, lat)
map.on('select' | 'hover' | 'navigate' | 'zoom', fn)     // map.ready = Promise da visão inicial
```

## Contrato de dados (para ligar nos circuitos reais)

Uma linha por município, chave = `codigo_ibge` (texto de 7 dígitos). Exemplo de consulta que alimenta o mapa:

```sql
SELECT codigo_ibge, COUNT(*) AS circuitos, COUNT(DISTINCT cliente_id) AS clientes
FROM circuitos GROUP BY codigo_ibge;
```

O `data/dim_municipio.csv` serve de tabela de apoio para resolver cidade/UF → código IBGE (cuidado com nomes homônimos: sempre cruzar por **nome + UF**, ou melhor, guardar o código IBGE na origem).

## Qualidade da geometria — leia isto

A fonte padrão (`--source npm`, pacote `ibge-cidades-com-poligonos`) é **bem simplificada: ~28 vértices por município em média**. Serve para a visão macro (estado/região, como no site que inspirou o projeto), mas municípios pequenos ficam poligonais ao dar muito zoom.

Para um mapa **realmente detalhado**, rode o build com a malha oficial do IBGE na sua máquina ou no homeserver (precisa de internet até `servicodados.ibge.gov.br`):

```bash
pip install shapely
python3 scripts/build_geo.py --source ibge --qualidade intermediaria   # ou maxima
python3 scripts/build_demo.py && node scripts/export_topojson.mjs
```

> ⚠️ O adaptador `--source ibge` **não pôde ser testado contra a API real** no ambiente em que o repositório foi montado (domínio bloqueado). A normalização foi validada com um fixture (`tests/test_build.py`), mas rode uma vez e confira o resultado. Se a API devolver outro formato, o ajuste fica concentrado em `parse_ibge_uf()`.

Outras limitações conhecidas: a fonte atual tem 5.567 dos 5.570 municípios (não identifiquei quais três faltam); a visão Brasil une os municípios por UF e simplifica o contorno, então as fronteiras entre estados podem ter pequenas folgas invisíveis com a borda branca.

## Desenvolvimento

```bash
pip install shapely playwright    # playwright só p/ os testes ponta a ponta
npm install                       # só p/ o export TopoJSON
./scripts/fetch_source.sh         # baixa a fonte padrão (data/source/, não versionada)
npm run build                     # geometrias + demo + topojson
npm test                          # unitários + ponta a ponta
```

## Dados e licenças

Malhas e códigos municipais: IBGE (dado público). A fonte padrão é o pacote npm `ibge-cidades-com-poligonos` (ISC), que por sua vez referencia `eduardo-veras/kml-brasil` — confirme a licença dessas origens antes de redistribuir o repositório fora da empresa. Dados do demo são **fictícios**.

Endereço e localização de circuitos de clientes B2B são dados sensíveis: mantenha o mapa com dados reais em ambiente interno (autenticado), nunca em página pública.
