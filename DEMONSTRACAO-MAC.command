#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then open https://nodejs.org/pt; echo "Instale o Node.js LTS e rode novamente."; read; exit; fi
[ -d node_modules ] || npm install --omit=dev
[ -f data/demo.sqlite ] || node --disable-warning=ExperimentalWarning scripts/demo-data.js
echo "DEMONSTRAÇÃO — entre com irineu@demo.com.br / Demo1234"
(sleep 2; open http://localhost:3000) &
node --disable-warning=ExperimentalWarning server/index.js --demo
