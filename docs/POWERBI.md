# Levando o mapa para o Power BI

Ideias para a fase seguinte, em ordem de esforço. Os itens marcados **(validar)** dependem de configuração do tenant/versão e **não foram testados** — confirme no seu ambiente antes de planejar em cima deles.

## 1. Shape Map nativo — o mais rápido

- Visual *Shape Map* com mapa personalizado: carregue `export/topojson/uf/CE.topo.json` (um estado) ou `brasil_estados.topo.json`.
- A chave de junção é a propriedade `codigo_ibge` (municípios) ou `uf` (estados) das geometrias; no modelo, use a coluna `codigo_ibge` de `data/dim_municipio.csv` como dimensão e relacione com a tabela de circuitos.
- Limite: só coroplético, sem pontos, sem o drill-down/painel do demo. Geometria é grosseira com a fonte padrão (ver README).
- **(validar)** exigência de formato/nomes de propriedades do Shape Map na sua versão.

## 2. Mapa de bolhas / calor por latitude-longitude

- Visual *Azure Maps* (ou o mapa de bolhas nativo): use as colunas `latitude`/`longitude` de `dim_municipio.csv` para uma bolha por município, **ou** as coordenadas reais dos circuitos para um mapa de calor verdadeiro.
- **(validar)** o Azure Maps precisa estar habilitado pelo admin do tenant e pode ter restrição de região.
- É o caminho natural para "mapa de calor de circuitos" quando houver lat/lon confiável por circuito.

## 3. Visual customizado (`.pbiviz`) com este mesmo mapa — o mais fiel

- Empacotar `giga-map.js` num visual do Power BI (`pbiviz`): o `update()` recebe a tabela (categoria = `codigo_ibge`, valor = métrica) e chama `map.setData()`.
- A geometria vai embutida no visual (`data/geo/bundle.json`, ~2,5 MB; dá para embutir só as UFs necessárias), o que evita requisições externas.
- Mantém tudo que o demo faz (drill Brasil → UF, tooltip, pontos), respeitando filtros e seleção cruzada do relatório se o visual implementar `ISelectionManager`.
- Esforço maior: TypeScript, `pbiviz`, ciclo de empacotamento e (se um dia for publicado na organização) revisão de segurança.

## 4. Página HTML hospedada ao lado do relatório

- O Power BI não executa JavaScript arbitrário dentro de visuais de HTML comuns **(validar)**; por isso uma página como `dist/demo.html` não "roda" dentro do relatório.
- Alternativa prática: hospedar a página num servidor interno (o homeserver, por exemplo), alimentada por uma API/consulta no MySQL, e abri-la por link/botão do relatório ou incorporada em SharePoint/Teams ao lado dele.
- Aqui entra o cuidado de acesso: os dados de circuitos por cliente não devem ficar numa URL pública.

## Qual escolher?

Para validar rápido, o caminho 1 ou 2. Para ter exatamente o mapa do demo dentro do BI, o caminho 3. Se o mapa for usado principalmente por quem não abre o BI, o caminho 4 com autenticação.
