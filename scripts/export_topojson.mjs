// Converte export/geojson/*.geojson em TopoJSON (export/topojson/*.topo.json).
// Uso: npm install && node scripts/export_topojson.mjs
// Útil para o visual "Shape Map" do Power BI (mapa personalizado), Deneb/Vega, D3, etc.
import { topology } from "topojson-server";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "export/geojson");
const dst = join(root, "export/topojson");
mkdirSync(join(dst, "uf"), { recursive: true });

function convert(inFile, outFile, objectName) {
  const gj = JSON.parse(readFileSync(inFile, "utf8"));
  // quantização 1e5 ≈ 1 m — mantém a geometria e reduz o tamanho
  const topo = topology({ [objectName]: gj }, 1e5);
  writeFileSync(outFile, JSON.stringify(topo));
}

convert(join(src, "brasil_estados.geojson"), join(dst, "brasil_estados.topo.json"), "estados");
let n = 0;
for (const f of readdirSync(join(src, "uf"))) {
  if (!f.endsWith(".geojson")) continue;
  convert(join(src, "uf", f), join(dst, "uf", f.replace(".geojson", ".topo.json")), "municipios");
  n++;
}
console.log(`TopoJSON: brasil_estados + ${n} UFs em export/topojson/`);
