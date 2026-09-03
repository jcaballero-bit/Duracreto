# Migrar DPCR-08 a un VPS propio

> Reemplaza el despliegue en Netlify + Neon (ver `deploy-netlify.md`, que queda
> como referencia histórica). Todo —app y base de datos— pasa a **un solo
> servidor** con costo fijo mensual y sin medidores de consumo.

## Por qué

| | Netlify + Neon | VPS propio |
|---|---|---|
| Costo | ~9 USD + riesgo de Neon Pro | **~12 USD fijos** |
| Medidores | CU-horas, egress, invocaciones, minutos de build | **ninguno** |
| Latencia app→BD | cada consulta cruza la red (439 puntos de consulta) | socket local, <1 ms |
| Autosuspensión | Neon duerme a los 5 min | no existe |
| Quién opera | el proveedor | **tú** |

Lo que se gana en velocidad no es la latencia del usuario: es que los **439
puntos de consulta a Prisma** dejan de pagar un viaje de red cada uno, y el motor
las hace en bucle (`cascadaMultiPlanta`, `organizarDia`).

Lo que se pierde: si el servidor se cae, se cae para los 7 planteles y nadie más
lo va a levantar. De ahí que el respaldo del Paso 10 no sea opcional.

## Antes de empezar

- [ ] VPS contratado. Recomendado: **Hetzner CPX21** (3 vCPU, 4 GB, 80 GB) en
      **Ashburn** — medido desde la red de la empresa: 73 ms. *No elijas
      Hillsboro: son 148 ms.* Alternativa si quieres la mejor latencia medida:
      Vultr o Linode en **Miami** (50 y 45 ms), al doble de precio.
- [ ] Imagen **Ubuntu 24.04 LTS**, con tu llave SSH cargada.
- [ ] Acceso al DNS de `duracreto.com`.
- [ ] La cadena de conexión de **Neon** a mano (está en las variables de entorno
      del sitio en Netlify).
- [ ] El repositorio accesible desde el servidor (`git clone` por HTTPS con token
      o por SSH con una llave de despliegue).

> **Decide el dominio ahora.** Si hoy la gente entra por una URL
> `*.netlify.app`, moverse a `dpcr08.duracreto.com` cambia el origen y **quien
> tenga la PWA instalada tendrá que reinstalarla** (una app instalada está atada
> a su origen). Si ya usas un dominio propio apuntando a Netlify, mantén el mismo
> nombre y el cambio es invisible: solo mueves el registro DNS.

---

## Paso 1 — Crear el servidor

En el panel de Hetzner: Ubuntu 24.04, tipo CPX21, ubicación **Ashburn, VA**, tu
llave SSH. Anota la IP pública.

```bash
ssh root@LA_IP
```

## Paso 2 — DNS

**Bájale el TTL primero**, un día antes de migrar: así el cambio final se propaga
en minutos y no en horas, y volver atrás también es rápido.

| Tipo | Nombre | Valor | TTL |
|------|--------|-------|-----|
| A | `dpcr08` | la IP del VPS | 300 |

Verifica antes de seguir — Caddy no puede sacar el certificado si el DNS todavía
no resuelve:

```bash
dig +short dpcr08.duracreto.com
```

## Paso 3 — Provisionar el servidor

```bash
git clone https://github.com/TU_USUARIO/duracreto.git /tmp/dpcr08
sudo bash /tmp/dpcr08/deploy/setup-servidor.sh
```

Deja instalado swap de 4 GB, Node 22, PostgreSQL 18 (desde PGDG, para igualar el
cluster de desarrollo), Caddy, rclone, cortafuegos y parches automáticos.

> **Guarda la cadena de conexión que imprime.** Es la única vez que se muestra la
> contraseña del rol de Postgres.

La base se crea en **UTF-8** a propósito: el cluster local quedó en WIN1252 y por
eso guardar un `→` o un emoji reventaba con `DriverAdapterError`. En este servidor
eso no puede repetirse.

## Paso 4 — Traer el código

```bash
sudo -u duracreto git clone https://github.com/TU_USUARIO/duracreto.git /opt/duracreto
cd /opt/duracreto
sudo -u duracreto npm ci          # el postinstall genera el cliente Prisma
```

## Paso 5 — Variables de entorno

```bash
sudo nano /etc/duracreto/env      # se creó desde deploy/env.ejemplo
```

Lo mínimo: `DATABASE_URL` (la del Paso 3) y `AUTH_SECRET`
(`openssl rand -base64 32`). Copia `ORS_API_KEY` y las de Google desde Netlify si
las usas.

> Un `AUTH_SECRET` distinto al de Netlify invalida las sesiones activas y todos
> vuelven a iniciar sesión una vez. Es lo normal en una migración; si prefieres
> que nadie lo note, copia el que ya está en Netlify.

Los secretos viven en `/etc`, no en el repositorio: un `git pull` no los pisa.

## Paso 6 — Traer los datos desde Neon

El corazón de la migración. **Hazlo dos veces**: un ensayo ahora para validar, y
el definitivo en el cambio de DNS (Paso 11).

```bash
# 1. Volcar desde Neon (se corre EN EL VPS: ahí está el cliente de PG 18)
cd /tmp
pg_dump --format=custom --no-owner --no-privileges \
  --file=neon-ensayo.dump \
  "postgresql://USUARIO:CLAVE@ep-xxxx.neon.tech/duracreto?sslmode=require"

# 2. Restaurar
sudo /opt/duracreto/deploy/restaurar.sh /tmp/neon-ensayo.dump
```

El script pide confirmación escrita, renombra la base actual a `duracreto_previa`
antes de tocar nada, y al final imprime las tablas con más filas.

**Verifica que los conteos cuadren** con Neon, tabla por tabla:

```bash
# En el VPS
sudo -u postgres psql -d duracreto -c \
  "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;"

# Contra Neon, mismo comando cambiando la conexión
psql "postgresql://...neon...?sslmode=require" -c \
  "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;"
```

> `_prisma_migrations` viene dentro del volcado, así que **no corras las
> migraciones aparte**: la base llega ya al día. Si quieres confirmarlo,
> `sudo -u duracreto node scripts/migrate-deploy.mjs` no debe aplicar ninguna.

## Paso 7 — Caddy y el certificado

```bash
sudo cp /opt/duracreto/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile          # ajusta el dominio si usas otro
sudo systemctl reload caddy
sudo journalctl -u caddy -n 20          # debe decir que obtuvo el certificado
```

El HTTPS **no es opcional en este sistema**: sin contexto seguro se cae
`navigator.geolocation` (la captura GPS es obligatoria para dar de alta un cliente
nuevo) y no aparece el botón de instalar la PWA.

El `Caddyfile` trae dos líneas que parecen detalle y no lo son:

- `encode zstd gzip` — las páginas pesan ~690 KB en crudo y ~24 KB comprimidas.
  Netlify comprimía por defecto; aquí hay que pedirlo.
- `request_body max_size 12MB` — el archivo del reloj biométrico sube por una
  server action con límite de 8 MB en `next.config.ts`. El tope de Caddy tiene que
  quedar por encima o una catorcena completa fallaría sin mensaje claro.

## Paso 8 — Arrancar la app

```bash
sudo cp /opt/duracreto/deploy/duracreto.service /etc/systemd/system/
sudo systemctl daemon-reload
cd /opt/duracreto && sudo -u duracreto env NODE_ENV=production npm run build
sudo systemctl enable --now duracreto
sudo systemctl status duracreto
sudo journalctl -u duracreto -f
```

## Paso 9 — Verificación funcional

No basta con que cargue la portada. Esta lista cubre lo que se rompe al cambiar
de plataforma:

- [ ] **Login** con `jcaballero@duracreto.com` y con un usuario no-admin.
- [ ] **Zona horaria**: `date` en el servidor dice `-06`, y una hora en
      `/programacion` coincide con la real. (`TZ` está en el unit de systemd, que
      es el estándar de oro que pide el comentario de `instrumentation.ts`.)
- [ ] **Contexto seguro**: en el menú de usuario aparece "Instalar app".
- [ ] **GPS**: crea un cliente de prueba y usa "Usar mi ubicación actual". Es la
      prueba real del HTTPS. Bórralo después.
- [ ] **PDF del DPCR-08**: genera uno y confirma que **sale el logo**
      (`@react-pdf/renderer` lee `public/logo-duracreto.png`).
- [ ] **Mapa de cobertura** en `/comercial`: los tiles y el Leaflet auto-alojado
      en `/vendor/leaflet` deben cargar (el `middleware` excluye `.css`/`.js`).
- [ ] **Reloj biométrico**: sube el archivo real en `/planilla/importar`. Prueba
      los límites de Caddy y de Next a la vez.
- [ ] **Roles**: entra como Programador y confirma el 307 en `/planilla`.
- [ ] Opcional pero recomendado: `npm test` en el servidor (crea la BD
      `duracreto_test` sola). Las 718 pruebas verdes son la mejor señal de que
      nada se movió.

## Paso 10 — Respaldos (no es opcional)

Hoy **no existe ningún respaldo**. En un VPS propio eso deja de ser una deuda y
pasa a ser un riesgo de pérdida total: nómina de 90 personas, bitácora completa y
63 migraciones de historial.

```bash
# Configurar el destino remoto como el usuario de la app
sudo -u duracreto rclone config        # crea un remoto "gdrive" (Google Drive)

sudo cp /opt/duracreto/deploy/duracreto-backup.service /etc/systemd/system/
sudo cp /opt/duracreto/deploy/duracreto-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now duracreto-backup.timer

# Probarlo YA, no esperar a las 2:30 a.m.
sudo systemctl start duracreto-backup.service
sudo journalctl -u duracreto-backup -n 30
```

`backup.sh` verifica que el volcado traiga al menos 10 tablas con datos antes de
darlo por bueno, y **falla si no logra subirlo fuera del servidor**: una copia que
solo vive en el mismo disco no es un respaldo.

> **Prueba la restauración una vez.** Un respaldo sin restauración probada es una
> suposición. Restaura el último volcado sobre una base de prueba y compara
> conteos.

## Paso 11 — El cambio (cutover)

Con el ensayo del Paso 6 validado:

1. Avisa la ventana (fuera de horario: el sistema se usa de 7 a.m. a 5 p.m.).
2. **Congela las escrituras** en Netlify: lo más simple es pausar el sitio (Site
   settings → Pause site) para que nadie despache mientras copias.
3. Volcado **definitivo** desde Neon y restauración (mismos comandos del Paso 6,
   sin el `-ensayo`).
4. Cambia el registro A al VPS. Con TTL 300 propaga en minutos.
5. Recorre otra vez la lista del Paso 9.
6. **No borres nada de Netlify ni de Neon todavía.** Déjalos una o dos semanas.

**Plan de retorno**: si algo sale mal, devuelve el registro A a Netlify y
reactiva el sitio. Los datos que hayan entrado al VPS en ese rato habría que
volcarlos de vuelta a Neon a mano, así que cuanto antes decidas, mejor.

## Operación diaria

```bash
sudo /opt/duracreto/deploy/deploy.sh    # desplegar lo último de main
sudo journalctl -u duracreto -f         # ver registros en vivo
sudo systemctl restart duracreto        # reiniciar
```

`deploy.sh` **detiene la app durante el build** a propósito: `next build`
reescribe `.next` mientras el proceso lo lee y `npm ci` borra `node_modules`
completo — hacerlo en caliente produce fallos intermitentes difíciles de
diagnosticar. La ventana es de 1 a 3 minutos. Si el build falla, el script
**vuelve al commit anterior, reconstruye y arranca** solo.

Omite `npm ci` cuando `package-lock.json` no cambió, que es la mayoría de los
despliegues.

## Después de migrar: qué revertir

Sin medidores, varias optimizaciones dejan de tener sentido y puedes devolverle
velocidad a la operación:

| Dónde | Hoy | Puede volver a |
|---|---|---|
| `AutoRefresh` en `/despacho` | 60 s | **10 s** |
| `AutoRefresh` en `/programacion` y `/confirmaciones` | 90 s | **15 s** |
| Espaciado progresivo (tope de 9 min) | necesidad | lujo, se puede quitar |
| Pausa por inactividad (4 min) | necesidad | opcional |
| Agrupar despliegues por minutos de build | necesidad | ya no aplica |

El latido cuesta 36 bytes y una consulta: sin egress medido no hay razón para
hacer esperar a nadie.

## Lo que NO cambia

- `netlify.toml` se puede dejar en el repo: no molesta y documenta el camino
  anterior. Si prefieres, bórralo cuando desmontes el sitio.
- Ninguna línea de lógica de negocio. El motor, los guards, las 718 pruebas y las
  63 migraciones son idénticos: solo cambia dónde corre el proceso y a qué
  Postgres se conecta.
- `trustHost: true` ya está en `auth.config.ts`, así que Auth.js funciona detrás
  de Caddy sin tocar nada. Es el error clásico de estas migraciones y este
  proyecto ya lo tenía resuelto.

## Lo que sí rompería el costo fijo más adelante

Notificaciones por WhatsApp o SMS (se cobran por mensaje), correo transaccional
más allá del plan gratuito, y cualquier función con IA — el VPS no tiene GPU. Para
eso está la máquina con la 3080 en la oficina, como servidor auxiliar.
