# deploy/ — archivos del servidor propio

Todo lo necesario para correr DPCR-08 en un VPS con costo fijo, sin Netlify ni
Neon. **La guía paso a paso es [`docs/despliegue-vps.md`](../docs/despliegue-vps.md)**
— esto es solo el índice de qué hace cada archivo.

| Archivo | Qué es | Dónde va |
|---|---|---|
| `setup-servidor.sh` | Provisión inicial: swap, Node 22, PostgreSQL 18, Caddy, rclone, cortafuegos, parches. Idempotente. | se corre una vez |
| `env.ejemplo` | Plantilla de las variables de entorno (secretos fuera del repo) | `/etc/duracreto/env` (0600) |
| `Caddyfile` | Proxy inverso con TLS automático de Let's Encrypt | `/etc/caddy/Caddyfile` |
| `duracreto.service` | La app como servicio de systemd, con `TZ` explícita | `/etc/systemd/system/` |
| `deploy.sh` | Despliega `main`: pull, migraciones, build, reinicio, con retorno automático si falla | se corre a demanda |
| `backup.sh` | Volcado diario verificado + copia fuera del servidor | lo dispara el timer |
| `duracreto-backup.service` + `.timer` | Programa el respaldo a las 2:30 a.m., recuperando la corrida perdida si el servidor estuvo apagado | `/etc/systemd/system/` |
| `restaurar.sh` | Restaura un volcado. **Destructivo**, pide confirmación escrita. Se usa para traer los datos de Neon y para recuperarse de un desastre | a demanda |

## Tres cosas que no se pueden omitir

1. **HTTPS.** Sin contexto seguro se cae `navigator.geolocation` — y la captura
   GPS es obligatoria para dar de alta un cliente nuevo — y desaparece el botón de
   instalar la PWA. Lo resuelve el `Caddyfile`.
2. **`encode zstd gzip` en Caddy.** Las páginas pesan ~690 KB en crudo y ~24 KB
   comprimidas. Netlify comprimía por defecto; aquí hay que pedirlo.
3. **El respaldo fuera del servidor.** Hoy el proyecto no tiene ninguno. En un
   servidor propio, un disco perdido sin copia externa es la pérdida total de la
   nómina, la bitácora y el historial de migraciones.

## Lo que este directorio no toca

Ninguna línea de lógica de negocio. El motor, los guards de permisos, las
migraciones y las 718 pruebas son idénticos: solo cambia dónde corre el proceso y
a qué Postgres se conecta.
