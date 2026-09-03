#!/usr/bin/env bash
# Respaldo de la base de datos DPCR-08. Lo dispara duracreto-backup.timer a diario.
#
# Guarda una copia LOCAL con rotacion y la sube FUERA del servidor. Las dos cosas
# importan: un snapshot del proveedor no te salva si el problema es la cuenta, y
# una copia local no te salva si el disco muere.
set -euo pipefail

DIR="/var/backups/duracreto"
RETENER_DIAS=30
DESTINO_REMOTO="${RCLONE_REMOTO:-}"   # ej. gdrive:respaldos-dpcr08   (opcional)

log()   { printf "[respaldo] %s\n" "$*"; }
error() { printf "[respaldo] ERROR: %s\n" "$*" >&2; }

: "${DATABASE_URL:?DATABASE_URL no esta definida (viene de /etc/duracreto/env)}"

mkdir -p "$DIR"
ARCHIVO="${DIR}/duracreto-$(date +%Y-%m-%d_%H%M).dump"

# -Fc = formato custom: ya viene comprimido y permite restaurar tablas sueltas.
log "Volcando la base"
pg_dump --format=custom --no-owner --no-privileges --file="$ARCHIVO" "$DATABASE_URL"

# Un respaldo que no se puede leer no es un respaldo. Se verifica que el archivo
# sea un volcado valido y que traiga tablas, no solo el esquema vacio.
log "Verificando integridad"
TABLAS=$(pg_restore --list "$ARCHIVO" | grep -c "TABLE DATA" || true)
if [ "$TABLAS" -lt 10 ]; then
  error "El volcado solo trae ${TABLAS} tablas con datos. Algo esta mal."
  rm -f "$ARCHIVO"
  exit 1
fi
log "OK: ${TABLAS} tablas con datos, $(du -h "$ARCHIVO" | cut -f1)"

# ── Copia fuera del servidor ────────────────────────────────────────────────
if [ -n "$DESTINO_REMOTO" ]; then
  log "Subiendo a ${DESTINO_REMOTO}"
  if rclone copy --quiet "$ARCHIVO" "$DESTINO_REMOTO"; then
    log "Subido"
  else
    # No se borra el local ni se marca exito: hay que enterarse de esto.
    error "Fallo la subida a ${DESTINO_REMOTO}. La copia local si quedo."
    exit 1
  fi
else
  error "RCLONE_REMOTO no esta configurado: NO hay copia fuera del servidor."
  error "Configuralo en /etc/duracreto/env (ver docs/despliegue-vps.md, Paso 10)."
fi

# ── Rotacion local ──────────────────────────────────────────────────────────
log "Borrando copias locales de mas de ${RETENER_DIAS} dias"
find "$DIR" -name 'duracreto-*.dump' -type f -mtime "+${RETENER_DIAS}" -print -delete

log "Listo. Copias locales: $(find "$DIR" -name 'duracreto-*.dump' | wc -l)"
