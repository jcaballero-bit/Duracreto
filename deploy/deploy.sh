#!/usr/bin/env bash
# Despliega la version actual de main en el VPS.
#
#   sudo /opt/duracreto/deploy/deploy.sh
#
# Con UN solo servidor un despliegue implica una ventana corta sin servicio
# (~1-3 min: npm ci + build). Se detiene la app a proposito: `next build`
# reescribe .next mientras el proceso lo esta leyendo, y `npm ci` borra
# node_modules completo. Hacerlo "en caliente" produce fallos intermitentes
# dificiles de diagnosticar. Despliega de noche o avisa antes.
set -euo pipefail

APP_DIR="/opt/duracreto"
APP_USER="duracreto"
SERVICIO="duracreto"
PUERTO="3000"

log()   { printf "\n\033[1;34m==>\033[0m %s\n" "$*"; }
error() { printf "\n\033[1;31mERROR:\033[0m %s\n" "$*" >&2; }

[ "$(id -u)" -eq 0 ] || { error "Corre esto con sudo."; exit 1; }
cd "$APP_DIR"

como_app() { sudo -u "$APP_USER" env HOME="/home/$APP_USER" "$@"; }

# ── Punto de retorno ────────────────────────────────────────────────────────
COMMIT_ANTERIOR=$(como_app git rev-parse HEAD)
log "Commit actual: ${COMMIT_ANTERIOR:0:8}"

LOCK_ANTES=$(sha256sum package-lock.json | cut -d' ' -f1)

log "Trayendo cambios"
como_app git fetch --quiet origin
como_app git reset --hard --quiet origin/main
COMMIT_NUEVO=$(como_app git rev-parse HEAD)

if [ "$COMMIT_ANTERIOR" = "$COMMIT_NUEVO" ]; then
  log "Ya estaba al dia (${COMMIT_NUEVO:0:8}). Nada que hacer."
  exit 0
fi
log "Nuevo commit: ${COMMIT_NUEVO:0:8}"
como_app git --no-pager log --oneline "${COMMIT_ANTERIOR}..${COMMIT_NUEVO}" | head -20

LOCK_DESPUES=$(sha256sum package-lock.json | cut -d' ' -f1)

# ── Construir ───────────────────────────────────────────────────────────────
log "Deteniendo el servicio"
systemctl stop "$SERVICIO"

construir() {
  if [ "$LOCK_ANTES" != "$LOCK_DESPUES" ] || [ ! -d node_modules ]; then
    log "package-lock cambio -> npm ci (regenera el cliente Prisma en postinstall)"
    como_app npm ci
  else
    log "package-lock igual -> se omite npm ci"
    # El cliente Prisma esta en .gitignore; si el esquema cambio hay que regenerarlo.
    como_app npx prisma generate
  fi

  log "Aplicando migraciones pendientes"
  # Se extrae SOLO DATABASE_URL en vez de exportar el archivo completo con xargs:
  # un valor con caracteres especiales rompe ese truco de forma silenciosa.
  DB_URL=$(sed -n 's/^DATABASE_URL=//p' /etc/duracreto/env | head -1)
  [ -n "$DB_URL" ] || { error "DATABASE_URL no esta en /etc/duracreto/env"; return 1; }
  como_app env DATABASE_URL="$DB_URL" TZ=America/Tegucigalpa node scripts/migrate-deploy.mjs

  log "Compilando"
  como_app env NODE_ENV=production TZ=America/Tegucigalpa npm run build
}

if ! construir; then
  error "El build o las migraciones fallaron. Volviendo a ${COMMIT_ANTERIOR:0:8}"
  como_app git reset --hard --quiet "$COMMIT_ANTERIOR"
  LOCK_DESPUES=$(sha256sum package-lock.json | cut -d' ' -f1)
  construir || { error "Tampoco reconstruye la version anterior. Revisa a mano."; exit 1; }
  systemctl start "$SERVICIO"
  error "Se restauro la version anterior. El despliegue NO se aplico."
  exit 1
fi

# ── Arrancar y verificar ────────────────────────────────────────────────────
log "Arrancando"
systemctl start "$SERVICIO"

# /login es la unica pagina publica del sistema (lo verifica
# tests/guards-cobertura.test.ts), asi que sirve como sonda de salud.
log "Verificando"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PUERTO}/login"; then
    log "Responde. Despliegue completo: ${COMMIT_NUEVO:0:8}"
    systemctl --no-pager status "$SERVICIO" | head -5
    exit 0
  fi
  sleep 2
done

error "No responde despues de 60 s. Ultimos registros:"
journalctl -u "$SERVICIO" -n 40 --no-pager
exit 1
