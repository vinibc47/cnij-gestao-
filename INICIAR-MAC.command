#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Instale o Node.js (versão LTS) em https://nodejs.org/pt e rode novamente."; open https://nodejs.org/pt; read; exit; fi
[ -d node_modules ] || npm install --omit=dev
(sleep 2; open http://localhost:3000) &
echo "Sistema iniciado. NÃO feche esta janela enquanto estiver usando."
node --disable-warning=ExperimentalWarning server/index.js
