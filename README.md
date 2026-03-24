# Knodel

Nodo completo de **Koinos** como aplicacion de escritorio. Incluye dashboard, explorador de bloques, wallet y los 12 microservicios compilados nativamente — sin Docker, sin dependencias externas.

## Stack

- **Desktop app:** Electron + React + TypeScript
- **Microservicios Koinos:** 5 C++ + 5 Go + 1 Node.js + 1 AMQP broker
- **Comunicacion interna:** AMQP 0.9.1 (GarageMQ)
- **Plataformas:** Windows (x64) y macOS (ARM64 / Intel)

## Quick start

```bash
git clone --recurse-submodules git@github.com:pgarciagon/knodel.git
cd knodel
npm install
npm run dev
```

> Si ya clonaste sin submodules: `git submodule update --init --recursive`

## Compilar servicios nativos

Los 12 microservicios de Koinos se compilan desde source. La primera compilacion tarda ~30 min (Hunter descarga y compila todas las dependencias C++). Las siguientes usan cache.

### macOS (ARM64 / Intel)

Requisitos: Xcode CLT, CMake 3.28.x, Go 1.22+, Node.js 20+, GMP (`brew install gmp`)

```bash
./scripts/build-native-mac.sh          # todo
./scripts/build-native-mac.sh go       # solo Go services
./scripts/build-native-mac.sh cpp      # solo C++ services
./scripts/build-native-mac.sh rest     # solo koinos-rest
./scripts/build-native-mac.sh amqp     # solo GarageMQ
```

> En Apple Silicon, el script parchea automaticamente Hunter (ZLIB, abseil, rocksdb CRC, gRPC) para ARM64.

### Windows (x64)

Requisitos: Visual Studio Build Tools (C++), CMake 3.20+, Go 1.21+, Node.js 20+

```bash
scripts\build-native-win.bat
```

## Servicios incluidos

| Servicio | Tipo | Funcion |
|---|---|---|
| **koinos-chain** | C++ | Estado de la blockchain, ejecucion WASM |
| **koinos-mempool** | C++ | Pool de transacciones pendientes |
| **koinos-grpc** | C++ | Gateway gRPC |
| **koinos-block-producer** | C++ | Produccion de bloques |
| **koinos-account-history** | C++ | Historial de cuentas |
| **koinos-block-store** | Go | Almacenamiento de bloques (BadgerDB) |
| **koinos-p2p** | Go | Red P2P (libp2p) |
| **koinos-jsonrpc** | Go | Gateway JSON-RPC |
| **koinos-transaction-store** | Go | Almacenamiento de transacciones |
| **koinos-contract-meta-store** | Go | Indice de ABIs de contratos |
| **koinos-rest** | Node.js | API REST |
| **GarageMQ** | Go | Broker AMQP 0.9.1 |

## Building for distribution

### macOS

```bash
npm run package:mac:native    # DMG con servicios nativos
npm run package:mac           # DMG firmado + notarizado
npm run package:mac:unsigned  # DMG sin firma (desarrollo)
```

### Windows

```bash
npm run package:win           # Instalador NSIS
```

## Desarrollo

### Probar en web (sin Electron)

```bash
npm run dev:renderer
```

Abrir: `http://localhost:5173`

### Tests

```bash
npm run test:backend
```

## Arquitectura

```
Electron (UI)
  |
  +-- Dashboard     (metricas, estado de servicios)
  +-- Explorer      (bloques, transacciones, detalle inline)
  +-- Wallet        (cuentas, transferencias, staking)
  +-- Settings      (config de microservicios, idioma, rutas)
  |
  +-- electron/main.ts  (orquestador de procesos nativos)
        |
        +-- GarageMQ (AMQP broker)
        +-- koinos-chain, mempool, p2p, block-store, ...
        +-- koinos-rest (API)
```

## Referencias

- Koinos: https://koinos.io
- Backups blockchain: https://seed.koinosfoundation.org/backups
