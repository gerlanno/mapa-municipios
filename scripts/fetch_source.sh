#!/usr/bin/env bash
# Baixa a fonte padrão da malha municipal (pacote npm ibge-cidades-com-poligonos) para data/source/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
npm pack ibge-cidades-com-poligonos >/dev/null
tar -xzf ibge-cidades-com-poligonos-*.tgz
mkdir -p "$ROOT/data/source"
cp package/municipios-poligonos.json "$ROOT/data/source/municipios-poligonos.json"
echo "OK: data/source/municipios-poligonos.json"
