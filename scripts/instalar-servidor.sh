#!/bin/bash
# =====================================================================
# Instalação automática do CN·IJ Gestão em um servidor Ubuntu
# (ex.: Oracle Cloud "Always Free"). Instala Docker, abre as portas,
# baixa o sistema do GitHub, ativa HTTPS gratuito e inicia tudo.
#
# Uso:  bash instalar-servidor.sh USUARIO/REPOSITORIO [dominio-opcional]
# Rodar de novo = atualizar o sistema (os dados são preservados).
# =====================================================================
set -e
REPO="${1:?Informe o repositório, ex.: joao/cnij-gestao}"
DOMAIN="${2:-$DOMAIN}"
BASE=/opt/cnij
LOG=/var/log/cnij-instalacao.log
exec > >(tee -a "$LOG") 2>&1
echo "==> Instalação iniciada em $(date)"

export DEBIAN_FRONTEND=noninteractive
# Memória extra (servidores gratuitos têm pouca RAM)
if [ ! -f /swapfile ]; then fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi

# Docker
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
systemctl enable --now docker

# Libera portas 80 e 443 no firewall interno do servidor (imagens da Oracle bloqueiam por padrão)
for p in 80 443; do iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport $p -j ACCEPT; done
apt-get install -y iptables-persistent >/dev/null 2>&1 || true
netfilter-persistent save >/dev/null 2>&1 || true

# Baixa o sistema (mantém a pasta de dados)
mkdir -p $BASE/dados
rm -rf $BASE/app.new && mkdir -p $BASE/app.new
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" | tar xz --strip-components=1 -C $BASE/app.new
[ -f $BASE/app.new/package.json ] || { echo "ERRO: não encontrei o sistema no repositório $REPO (ele precisa ser público e ter o package.json na raiz)."; exit 1; }
rm -rf $BASE/app && mv $BASE/app.new $BASE/app

# Endereço do site: domínio próprio ou um endereço gratuito baseado no IP (sslip.io)
IP=$(curl -fsS https://api.ipify.org || curl -fsS ifconfig.me)
if [ -z "$DOMAIN" ] && [ -f $BASE/.domain ]; then DOMAIN=$(cat $BASE/.domain); fi
[ -z "$DOMAIN" ] && DOMAIN="$(echo "$IP" | tr . -).sslip.io"
echo "$DOMAIN" > $BASE/.domain

if [ ! -f $BASE/.env ]; then
cat > $BASE/.env <<ENV
APP_URL=https://$DOMAIN
COOKIE_SECURE=1
TRUST_PROXY=1
TZ=America/Cuiaba
MAX_UPLOAD_MB=30
ENV
else
  sed -i "s|^APP_URL=.*|APP_URL=https://$DOMAIN|" $BASE/.env
fi

cat > $BASE/Caddyfile <<CADDY
$DOMAIN {
  encode gzip
  request_body {
    max_size 40MB
  }
  reverse_proxy app:3000
}
CADDY

cat > $BASE/docker-compose.yml <<'COMPOSE'
services:
  app:
    build: ./app
    restart: unless-stopped
    env_file: .env
    volumes: ["./dados:/data"]
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile", "caddy_data:/data", "caddy_config:/config"]
    depends_on: [app]
volumes:
  caddy_data:
  caddy_config:
COMPOSE

cd $BASE && docker compose up -d --build

# Atalho para atualizar depois:  sudo cnij-atualizar
cat > /usr/local/bin/cnij-atualizar <<UPD
#!/bin/bash
curl -fsSL "https://raw.githubusercontent.com/$REPO/main/scripts/instalar-servidor.sh" | bash -s -- "$REPO" "\${1:-}"
UPD
chmod +x /usr/local/bin/cnij-atualizar

echo ""
echo "=================================================================="
echo " CN·IJ Gestão instalado!  Acesse:  https://$DOMAIN"
echo " (o certificado HTTPS pode levar 1 a 2 minutos na primeira vez)"
echo " Dados e backups ficam em $BASE/dados"
echo "=================================================================="
