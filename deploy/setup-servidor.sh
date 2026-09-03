#!/usr/bin/env bash
# Provisión inicial del VPS para DPCR-08. IDEMPOTENTE: se puede correr de nuevo
# sin romper nada (cada paso verifica antes de actuar).
#
#   sudo bash deploy/setup-servidor.sh
#
# Deja instalado: swap, Node 22, PostgreSQL 18 (PGDG), Caddy, rclone, ufw y
# actualizaciones automáticas de seguridad. NO despliega la app: eso es deploy.sh.
set -euo pipefail

APP_USER="duracreto"
APP_DIR="/opt/duracreto"
DB_NAME="duracreto"
DB_USER="duracreto"
PG_MAJOR="18"

log() { printf "\n\033[1;34m==>\033[0m %s\n" "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Corre esto con sudo."; exit 1; }

# ── 1. Swap ─────────────────────────────────────────────────────────────────
# `next build` de este proyecto pica en ~2–2.5 GB. Con 4 GB de RAM más Postgres
# y la app sirviendo, el swap es la red que evita que el build muera por OOM.
log "Swap de 4 GB"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Preferir RAM: el swap es para el pico del build, no para operar.
  sysctl -w vm.swappiness=10
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
else
  echo "   ya existe, se deja igual"
fi

# ── 2. Paquetes base ────────────────────────────────────────────────────────
log "Paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git ufw rclone \
  unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https

# ── 3. Node 22 LTS ──────────────────────────────────────────────────────────
# Netlify compila este proyecto con Node 20 y el desarrollo local usa 24, así que
# 20/22/24 sirven. Se fija 22 LTS por soporte largo.
log "Node 22 LTS"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

# ── 4. PostgreSQL 18 desde PGDG ─────────────────────────────────────────────
# Ubuntu 24.04 trae PG 16; se usa 18 para igualar el cluster embebido de
# desarrollo y evitar sorpresas de versión al restaurar el respaldo.
log "PostgreSQL ${PG_MAJOR}"
if ! command -v psql >/dev/null; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
http://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq "postgresql-${PG_MAJOR}" "postgresql-client-${PG_MAJOR}"
fi
systemctl enable --now postgresql

# ── 5. Base de datos y rol, en UTF-8 ────────────────────────────────────────
# CRÍTICO: el cluster de desarrollo local quedó en WIN1252 y por eso guardar un
# carácter fuera de Latin-1 (→, emojis) reventaba. Aquí se fuerza UTF-8 para que
# eso no pueda repetirse en producción.
log "Base de datos '${DB_NAME}' en UTF-8"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || {
  PGPASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
  sudo -u postgres psql -qc "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${PGPASS}';"
  echo
  echo "   ┌─────────────────────────────────────────────────────────────────┐"
  echo "   │ GUARDA ESTA CADENA — va en DATABASE_URL de /etc/duracreto/env  │"
  echo "   └─────────────────────────────────────────────────────────────────┘"
  echo "   postgresql://${DB_USER}:${PGPASS}@localhost:5432/${DB_NAME}?schema=public"
  echo
}
# Colación: se elige una locale UTF-8 real, NO "C". Con C, "Álvarez" ordenaría
# DESPUÉS de "Zelaya" y el orden alfabético de clientes cambiaría respecto a Neon.
if locale -a 2>/dev/null | grep -qiE "^en_US.utf-?8$"; then LOC="en_US.UTF-8"; else LOC="C.UTF-8"; fi
echo "   colación: ${LOC}"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres createdb -O "${DB_USER}" -E UTF8 -T template0 --lc-collate="${LOC}" --lc-ctype="${LOC}" "${DB_NAME}"
sudo -u postgres psql -tAc "SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname='${DB_NAME}'"

# Postgres para 4 GB de RAM y una base de decenas de MB: cabe entera en caché.
log "Ajuste de Postgres"
PGCONF="/etc/postgresql/${PG_MAJOR}/main/conf.d/duracreto.conf"
install -d "$(dirname "$PGCONF")"
cat > "$PGCONF" <<CONF
# Ajustes para DPCR-08 (4 GB RAM, base pequeña que cabe completa en caché).
shared_buffers = 1GB
effective_cache_size = 2GB
work_mem = 16MB
maintenance_work_mem = 256MB
timezone = 'America/Tegucigalpa'
CONF
systemctl restart postgresql

# ── 6. Caddy (TLS automático de Let's Encrypt) ──────────────────────────────
log "Caddy"
if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi

# ── 7. Usuario y directorio de la app ───────────────────────────────────────
log "Usuario '${APP_USER}' y ${APP_DIR}"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" /var/backups/duracreto

# ── 8. Secretos fuera del checkout de git ───────────────────────────────────
# Van en /etc, no en el repo: así un `git pull` nunca los pisa y no se filtran.
log "Archivo de entorno /etc/duracreto/env"
install -d -m 0755 /etc/duracreto
if [ ! -f /etc/duracreto/env ]; then
  cp "$(dirname "$0")/env.ejemplo" /etc/duracreto/env
  chmod 0600 /etc/duracreto/env
  echo "   creado desde la plantilla — EDÍTALO antes de arrancar"
else
  echo "   ya existe, no se toca"
fi

# ── 9. Cortafuegos ──────────────────────────────────────────────────────────
# Postgres NO se expone: la app le habla por localhost.
log "Cortafuegos"
ufw --force default deny incoming
ufw --force default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

# ── 10. Parches de seguridad automáticos ────────────────────────────────────
log "Actualizaciones automáticas"
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Listo. Sigue con el Paso 4 de docs/despliegue-vps.md"
