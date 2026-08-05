# Desplegar DPCR-08 en Netlify

> **Importante:** esto NO es "un archivo" que se sube. Es una app full-stack
> (Next.js 16 + Prisma + PostgreSQL + Auth.js). Netlify construye y hospeda **todo
> el repositorio**. El Postgres **embebido** que usas en local NO funciona en
> producción: necesitas una base de datos Postgres administrada en la nube.

## Resumen (lo que se necesita)

1. Una base de datos **PostgreSQL administrada** (Neon, Supabase, Railway…).
2. El repositorio en **GitHub/GitLab** (o subirlo con Netlify CLI).
3. Variables de entorno configuradas en Netlify (ver `.env.example`).
4. Aplicar migraciones y crear el usuario administrador en esa BD.

---

## Paso 1 — Crear la base de datos en la nube

La opción más simple y con capa gratis es **Neon** (https://neon.tech):

1. Crea un proyecto → te da una **connection string** tipo:
   `postgresql://user:pass@ep-xxxx.us-east-2.aws.neon.tech/duracreto?sslmode=require`
2. Guárdala: será tu `DATABASE_URL` (asegúrate de que termine en `?sslmode=require`).

(Supabase/Railway funcionan igual; solo copia su cadena de conexión Postgres.)

## Paso 2 — Subir el código a un repositorio Git

Netlify despliega desde un repo. Si aún no está en GitHub:

```bash
git init
git add .
git commit -m "DPCR-08 listo para desplegar"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/duracreto.git
git push -u origin main
```

## Paso 3 — Conectar el sitio en Netlify

1. Entra a https://app.netlify.com → **Add new site → Import an existing project**.
2. Autoriza y elige el repositorio `duracreto`.
3. Netlify detecta Next.js solo. La configuración de build ya viene en
   `netlify.toml` (comando `prisma migrate deploy && npm run build`, Node 20). No
   cambies nada ahí.

## Paso 4 — Configurar las variables de entorno

En **Site settings → Environment variables**, agrega (ver `.env.example`):

| Variable        | Valor                                                        |
|-----------------|--------------------------------------------------------------|
| `DATABASE_URL`  | La cadena de conexión del Paso 1 (con `?sslmode=require`)    |
| `AUTH_SECRET`   | Genéralo con `npx auth secret` (o `openssl rand -base64 32`) |
| `TZ`            | `America/Tegucigalpa`                                        |

Opcionales (login con Google): `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.

> El build corre `prisma migrate deploy`, que necesita `DATABASE_URL` disponible.
> Configúrala **antes** del primer deploy.

## Paso 5 — Primer deploy

Lanza el deploy (**Deploys → Trigger deploy**, o se dispara solo con el push).
El build: instala deps → `prisma generate` (postinstall) → `prisma migrate deploy`
(crea las tablas en tu Postgres) → `next build`.

## Paso 6 — Crear el usuario administrador (una sola vez)

Las tablas quedan vacías tras las migraciones. Necesitas un admin para entrar. Usa
el script `db:admin`, que **exige** una contraseña fuerte por variable de entorno y
crea el usuario con la marca de "cambiar contraseña al primer ingreso":

```bash
# PowerShell — apuntando a la BD de PRODUCCION
$env:DATABASE_URL="postgresql://...tu cadena...?sslmode=require"
$env:ADMIN_EMAIL="tucorreo@duracreto.com"
$env:ADMIN_PASSWORD="UnaClaveFuerteUnica"   # >= 8 caracteres, no la reutilices
npm run db:admin
```

Entra con ese correo y la contraseña que definiste; el sistema te pedirá cambiarla.
Después crea el resto de usuarios desde **Administración › Usuarios**.

> ⛔ **NUNCA** corras `npm run db:seed` contra producción: además de crear usuarios
> de demostración con contraseñas públicas (`admin123`, etc.), **BORRA todos los
> datos** (`limpiarBD`) antes de sembrar. `db:seed` es solo para desarrollo local.
> El repositorio es público, así que jamás dejes credenciales por defecto en vivo.

## Listo

Tu sitio queda en `https://TU-SITIO.netlify.app`. Cada `git push` a `main`
redepliega y aplica migraciones nuevas automáticamente.

---

## Notas y problemas comunes

- **Falla `prisma migrate deploy` en el build:** revisa que `DATABASE_URL` esté
  bien (incluido `?sslmode=require`) y que la BD acepte conexiones externas. Si
  prefieres no migrar en cada build, quita `npx prisma migrate deploy &&` del
  `command` en `netlify.toml` y corre las migraciones a mano una vez.
- **Alternativa Vercel:** este stack (Next.js + Prisma driver adapters) también
  corre en Vercel sin cambios; el proceso es equivalente (conectar repo + envs +
  BD administrada).
- **No subas el `.env`** real. En Netlify las variables van en el panel, no en el
  repositorio.
