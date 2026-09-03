#!/usr/bin/env bash
# Restaura un volcado sobre la base de datos. DESTRUCTIVO.
#
#   sudo /opt/duracreto/deploy/restaurar.sh /var/backups/duracreto/duracreto-2026-08-28_0230.dump
#
# Dos usos: (1) traer los datos de produccion desde Neon durante la migracion,
# (2) recuperarse de un desastre.
set -euo pipefail

ARCHIVO="${1:-}"
DB_NAME="duracreto"
DB_USER="duracreto"
SERVICIO="duracreto"

log()   { printf "\n\033[1;34m==>\033[0m %s\n" "$*"; }
error() { printf "\n\033[1;31mERROR:\033[0m %s\n" "$*" >&2; }

[ "$(id -u)" -eq 0 ] || { error "Corre esto con sudo."; exit 1; }
[ -n "$ARCHIVO" ] || { error "Uso: $0 <archivo.dump>"; exit 1; }
[ -f "$ARCHIVO" ] || { error "No existe: $ARCHIVO"; exit 1; }

log "Revisando el volcado"
TABLAS=$(pg_restore --list "$ARCHIVO" | grep -c "TABLE DATA" || true)
echo "   ${TABLAS} tablas con datos, $(du -h "$ARCHIVO" | cut -f1)"
[ "$TABLAS" -ge 10 ] || { error "El volcado parece incompleto."; exit 1; }

FILAS_ACTUALES=$(sudo -u postgres psql -tAd "$DB_NAME" -c \
  "SELECT COALESCE(sum(n_live_tup),0) FROM pg_stat_user_tables" 2>/dev/null || echo "0")

cat <<AVISO

  ┌──────────────────────────────────────────────────────────────────┐
  │  ESTO BORRA LA BASE DE DATOS ACTUAL Y LA REEMPLAZA               │
  └──────────────────────────────────────────────────────────────────┘
  Base destino : ${DB_NAME} (localhost)
  Filas ahora  : ${FILAS_ACTUALES}
  Volcado      : ${ARCHIVO}

AVISO
read -r -p "  Escribe RESTAURAR para continuar: " CONFIRMA
[ "$CONFIRMA" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }

log "Deteniendo la app (para que nadie escriba durante la restauracion)"
systemctl stop "$SERVICIO" 2>/dev/null || true

log "Recreando la base"
# Se conserva la colacion de la base existente para no cambiar el orden alfabetico.
LOC=$(sudo -u postgres psql -tAc "SELECT datcollate FROM pg_database WHERE datname='${DB_NAME}'" | tr -d ' ')
LOC="${LOC:-C.UTF-8}"
sudo -u postgres psql -qc "DROP DATABASE IF EXISTS ${DB_NAME}_previa;"
sudo -u postgres psql -qc "ALTER DATABASE ${DB_NAME} RENAME TO ${DB_NAME}_previa;" 2>/dev/null || true
sudo -u postgres createdb -O "$DB_USER" -E UTF8 -T template0 \
  --lc-collate="$LOC" --lc-ctype="$LOC" "$DB_NAME"

log "Restaurando"
# --no-owner / --no-privileges: el volcado viene de otro servidor (Neon) donde los
# roles se llaman distinto; sin esto el restore falla en cada GRANT.
sudo -u postgres pg_restore --dbname="$DB_NAME" --no-owner --no-privileges \
  --exit-on-error "$ARCHIVO" || {
    error "Fallo la restauracion. La base anterior quedo en ${DB_NAME}_previa."
    exit 1
  }
sudo -u postgres psql -qd "$DB_NAME" -c "ALTER SCHEMA public OWNER TO ${DB_USER};"
sudo -u postgres psql -qd "$DB_NAME" -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO ${DB_USER};"
sudo -u postgres psql -qd "$DB_NAME" -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};"

log "Verificando"
sudo -u postgres psql -d "$DB_NAME" -c \
  "SELECT relname, n_live_tup AS filas FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 12;"
echo "   Migraciones aplicadas: $(sudo -u postgres psql -tAd "$DB_NAME" -c 'SELECT count(*) FROM _prisma_migrations')"

log "Arrancando la app"
systemctl start "$SERVICIO"

cat <<FIN

  Listo. La base anterior quedo guardada como ${DB_NAME}_previa.
  Cuando confirmes que todo funciona, borrala:
    sudo -u postgres psql -c "DROP DATABASE ${DB_NAME}_previa;"

FIN
