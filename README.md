# Knodel

Explorador local para **Koinos** con enfoque en sincronización eficiente, indexación de bloques y estadísticas sin depender de un servicio externo.

## Stack recomendado (decisión actual)

- **Desktop app:** Electron + React + TypeScript
- **Indexador blockchain:** Go
- **Base de datos local:** SQLite
- **Comunicación interna:** API local (HTTP) entre Electron UI e indexador

Motivo: priorizar rapidez de desarrollo y portabilidad entre macOS y Windows para el MVP.

## Referencias oficiales

- Documentación de Koinos: https://koinos.io
- Backups de blockchain: https://seed.koinosfoundation.org/backups

## MVP actual (Issue #3)

Base de app desktop **sin conectividad real** a blockchain, con UI tipo block explorer y tabla dinámica con datos mock.

### Desarrollo local

```bash
npm install
npm run dev
```

### Build local

```bash
npm run build
```

### Package for macOS

```bash
npm install
npm run package:mac
```

This command generates the macOS app icon from `assets/branding/logo.png`, signs the app, and requires notarization credentials.

Artifacts:
- `.app`: `release/mac*/Knodel.app`
- `.dmg`: `release/Knodel-<version>-<arch>.dmg`

Notarization credentials:
- Recommended: set `APPLE_KEYCHAIN_PROFILE` after storing credentials with `xcrun notarytool store-credentials`
- Alternative: set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`
- Alternative: set `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`

For a signed local package without notarization:

```bash
npm run package:mac:signed
```

For an unpacked `.app` without generating a DMG:

```bash
npm run package:mac:dir
```

For an unsigned local package:

```bash
npm run package:mac:unsigned
```

## Compilar localmente en macOS

1. Instalar Node.js 20+ (recomendado con nvm).
2. Clonar repo:
   ```bash
   git clone git@github.com:pgarciagon/knodel.git
   cd knodel
   ```
3. Instalar dependencias:
   ```bash
   npm install
   ```
4. Ejecutar en desarrollo:
   ```bash
   npm run dev
   ```
5. Generar build:
   ```bash
   npm run build
   ```

> Nota: en esta fase no hay RPC ni datos reales; todo es mock para validar UI y compilación.


## Probar en web (sin instalar Electron)

```bash
npm install
npm run dev:renderer
```

Abrir: `http://localhost:5173`

## Deploy 1-click en Vercel (URL pública)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/pgarciagon/knodel&project-name=knodel-web&repository-name=knodel)

### Configuración de build en Vercel
- Framework preset: **Vite**
- Build command: `npm run build:web`
- Output directory: `dist`

Cuando lo importes en Vercel, te dará una URL pública tipo:
`https://knodel-web.vercel.app`

## Bootstrap offline-first desde backup

Para evitar sincronizar durante días desde cero, el MVP incluye bootstrap offline con backup de Koinos.

Referencias:
- Backup: http://seed.koinosfoundation.org/backups/
- Koinos: https://github.com/koinos/koinos
- Block store service: https://github.com/koinos/koinos-block-store

Comandos:

```bash
npm install
npm run bootstrap:offline
npm run api:local

# si ya tienes un .tar.gz local (ejemplo /root/koinos_blockchain_backup.tar.gz)
KNODEL_BACKUP_LOCAL_PATH=/root/koinos_blockchain_backup.tar.gz npm run bootstrap:offline
```

API local:
- `GET /health`
- `GET /blocks/latest?limit=20`
- `GET /blocks/:height`

Tests backend:

```bash
npm run test:backend
```

## Nodo local sin conflictos de puertos (fase inicial)

Para evitar conflictos con un nodo Koinos real ya corriendo en el servidor, Knodel usa un **perfil local con puertos dedicados**.

1. Copiar configuración local:

```bash
cp infra/koinos/.env.example infra/koinos/.env
```

2. Ajustar puertos y backup local en `infra/koinos/.env`.

3. Ejecutar preflight antes de arrancar servicios:

```bash
npm run koinos:preflight
```

El preflight valida:
- que los puertos del perfil local estén libres,
- que exista el backup local (`BACKUP_TAR_PATH`).

> Regla acordada: el bootstrap inicial siempre parte de backup local.
