# Knodel

Explorador local para **Koinos** con enfoque en sincronizacion eficiente, indexacion de bloques y estadisticas sin depender de un servicio externo.

## Stack

- **Desktop app:** Electron + React + TypeScript
- **Indexador blockchain:** Go
- **Base de datos local:** SQLite
- **Comunicacion interna:** API local (HTTP) entre Electron UI e indexador

Prioriza rapidez de desarrollo y portabilidad entre macOS y Windows para el MVP.

## Quick start

```bash
git clone --recurse-submodules git@github.com:pgarciagon/knodel.git
cd knodel
npm install
npm run dev
```

> Si ya clonaste sin submodules: `git submodule update --init --recursive`

## Probar en web (sin instalar Electron)

```bash
npm run dev:renderer
```

Abrir: `http://localhost:5173`

## Deploy 1-click en Vercel (URL publica)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/pgarciagon/knodel&project-name=knodel-web&repository-name=knodel)

- Framework preset: **Vite**
- Build command: `npm run build:web`
- Output directory: `dist`

---

## Desarrollo en macOS

1. Instalar Node.js 20+ (recomendado con nvm).
2. Clonar repo e instalar dependencias:
   ```bash
   git clone --recurse-submodules git@github.com:pgarciagon/knodel.git
   cd knodel
   npm install
   ```
3. Ejecutar en desarrollo:
   ```bash
   npm run dev
   ```
4. Generar build:
   ```bash
   npm run build
   ```

> Nota: en la fase MVP no hay RPC ni datos reales; todo es mock para validar UI y compilacion.

## Desarrollo en Windows 10

### Prerequisitos

| Herramienta | Para que | Instalacion |
|---|---|---|
| **Node.js 20+** | Runtime principal | https://nodejs.org (LTS) |
| **Git** | Control de versiones y submodules | https://git-scm.com |
| **Go 1.21+** | Compilar indexador nativo | https://go.dev/dl |
| **Python 3.12+** | Requerido por `node-gyp` (modulos nativos como better-sqlite3) | https://python.org (`Add to PATH` durante instalacion) |
| **Visual Studio Build Tools** | Compilador C++ para `node-gyp` | `npm install -g windows-build-tools` o instalar VS Build Tools con workload "Desktop C++" |
| CMake + MinGW *(opcional)* | Solo si quieres compilar servicios Koinos C++ nativos | https://cmake.org, https://www.mingw-w64.org |
| RabbitMQ *(opcional)* | Solo si quieres correr servicios Koinos con AMQP local | https://www.rabbitmq.com/install-windows.html |

### Pasos

```bash
git clone --recurse-submodules git@github.com:pgarciagon/knodel.git
cd knodel
npm install
npm run dev
```

Si `npm install` falla en modulos nativos (better-sqlite3), verificar que Python y Build Tools esten en PATH:

```bash
python --version
node -e "console.log(process.arch)"
```

---

## Building for distribution

### macOS

```bash
npm run package:mac
```

Genera `.app` y `.dmg` firmados en `release/`. Requiere credenciales de notarizacion de Apple.

Variantes disponibles:

| Comando | Descripcion |
|---|---|
| `npm run package:mac` | Firmado + notarizado + DMG |
| `npm run package:mac:signed` | Firmado sin notarizacion |
| `npm run package:mac:dir` | `.app` sin DMG |
| `npm run package:mac:unsigned` | Sin firma (desarrollo local) |

Credenciales de notarizacion:
- Recomendado: `APPLE_KEYCHAIN_PROFILE` (via `xcrun notarytool store-credentials`)
- Alternativa: `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`
- Alternativa: `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`

### Windows

```bash
npm run package:win
```

Genera instalador NSIS en `release/`. El instalador permite elegir directorio de instalacion.

Artifacts: `release/Knodel-<version>-<arch>.exe`

---

## Bootstrap offline-first desde backup

Para evitar sincronizar durante dias desde cero, el MVP incluye bootstrap offline con backup de Koinos.

```bash
npm install
npm run bootstrap:offline
npm run api:local
```

Si ya tienes un `.tar.gz` local:

```bash
KNODEL_BACKUP_LOCAL_PATH=/path/to/koinos_blockchain_backup.tar.gz npm run bootstrap:offline
```

Referencias:
- Backup: http://seed.koinosfoundation.org/backups/
- Koinos: https://github.com/koinos/koinos
- Block store service: https://github.com/koinos/koinos-block-store

---

## Compilar servicios Koinos nativos (opcional)

Si quieres compilar los servicios Koinos C++/Go desde source en lugar de usar binarios precompilados:

### Requisitos

- CMake 3.20+
- Go 1.21+
- Yarn (para proyectos JS del monorepo Koinos)
- En Windows: MinGW-w64 o Visual Studio con workload C++

### Build

```bash
cd services/koinos
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release
```

Los binarios quedan en `build/bin/`.

---

## Nodo local sin conflictos de puertos

Para evitar conflictos con un nodo Koinos real ya corriendo, Knodel usa un perfil local con puertos dedicados.

```bash
cp infra/koinos/.env.example infra/koinos/.env
# Ajustar puertos y backup local en infra/koinos/.env
npm run koinos:preflight
```

El preflight valida que los puertos del perfil local esten libres y que exista el backup local (`BACKUP_TAR_PATH`).

---

## API endpoints

| Metodo | Ruta | Descripcion |
|---|---|---|
| `GET` | `/health` | Estado del servidor |
| `GET` | `/blocks/latest?limit=20` | Ultimos bloques indexados |
| `GET` | `/blocks/:height` | Bloque por altura |

---

## Tests

```bash
npm run test:backend
```

---

## Referencias oficiales

- Documentacion de Koinos: https://koinos.io
- Backups de blockchain: https://seed.koinosfoundation.org/backups
