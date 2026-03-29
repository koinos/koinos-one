# Contribuir a los microservicios upstream

Este documento describe el flujo de trabajo para modificar los microservicios de
Knodel y contribuir esos cambios de vuelta a los repositorios oficiales de Koinos.

---

## Estructura de forks

Cada microservicio tiene un fork en `pgarciagon/<servicio>` con una rama
`knodel-patches` que sirve como base de trabajo. Los submodulos de Knodel apuntan
a estos forks, no a los repos oficiales.

```
koinos/<servicio>  (upstream oficial)
        │
        └── fork
            │
pgarciagon/<servicio>
  ├── master          ← espejo sincronizado del upstream
  ├── knodel-patches  ← cambios activos de Knodel (submodulo apunta aquí)
  └── fix/<nombre>    ← rama para PR upstream (temporal)
```

### Servicios configurados

| Submodulo | Fork | Upstream |
|-----------|------|----------|
| `vendor/koinos/koinos` | [pgarciagon/koinos](https://github.com/pgarciagon/koinos) | [koinos/koinos](https://github.com/koinos/koinos) |
| `vendor/koinos/koinos-chain` | [pgarciagon/koinos-chain](https://github.com/pgarciagon/koinos-chain) | [koinos/koinos-chain](https://github.com/koinos/koinos-chain) |
| `vendor/koinos/koinos-p2p` | [pgarciagon/koinos-p2p](https://github.com/pgarciagon/koinos-p2p) | [koinos/koinos-p2p](https://github.com/koinos/koinos-p2p) |
| `vendor/koinos/koinos-mempool` | [pgarciagon/koinos-mempool](https://github.com/pgarciagon/koinos-mempool) | [koinos/koinos-mempool](https://github.com/koinos/koinos-mempool) |
| `vendor/koinos/koinos-block-store` | [pgarciagon/koinos-block-store](https://github.com/pgarciagon/koinos-block-store) | [koinos/koinos-block-store](https://github.com/koinos/koinos-block-store) |
| `vendor/koinos/koinos-block-producer` | [pgarciagon/koinos-block-producer](https://github.com/pgarciagon/koinos-block-producer) | [koinos/koinos-block-producer](https://github.com/koinos/koinos-block-producer) |
| `vendor/koinos/koinos-jsonrpc` | [pgarciagon/koinos-jsonrpc](https://github.com/pgarciagon/koinos-jsonrpc) | [koinos/koinos-jsonrpc](https://github.com/koinos/koinos-jsonrpc) |
| `vendor/koinos/koinos-grpc` | [pgarciagon/koinos-grpc](https://github.com/pgarciagon/koinos-grpc) | [koinos/koinos-grpc](https://github.com/koinos/koinos-grpc) |
| `vendor/koinos/koinos-transaction-store` | [pgarciagon/koinos-transaction-store](https://github.com/pgarciagon/koinos-transaction-store) | [koinos/koinos-transaction-store](https://github.com/koinos/koinos-transaction-store) |
| `vendor/koinos/koinos-contract-meta-store` | [pgarciagon/koinos-contract-meta-store](https://github.com/pgarciagon/koinos-contract-meta-store) | [koinos/koinos-contract-meta-store](https://github.com/koinos/koinos-contract-meta-store) |
| `vendor/koinos/koinos-account-history` | [pgarciagon/koinos-account-history](https://github.com/pgarciagon/koinos-account-history) | [koinos/koinos-account-history](https://github.com/koinos/koinos-account-history) |
| `vendor/koinos/koinos-rest` | [pgarciagon/koinos-rest](https://github.com/pgarciagon/koinos-rest) | [koinos/koinos-rest](https://github.com/koinos/koinos-rest) |
| `vendor/amqp-broker` | [pgarciagon/garagemq](https://github.com/pgarciagon/garagemq) | [yowFung/garagemq](https://github.com/yowFung/garagemq) |

---

## Flujos de trabajo

### 1. Inicializar un submodulo por primera vez

Los submodulos no están clonados localmente hasta que los necesitas.
Para inicializar uno:

```bash
git submodule update --init vendor/koinos/koinos-mempool
cd vendor/koinos/koinos-mempool
git checkout knodel-patches
```

Para inicializarlos todos de una vez:

```bash
git submodule update --init --recursive
```

---

### 2. Hacer un cambio específico de Knodel

Cambios que no tienen sentido para el upstream: rutas locales, integración con
Electron, comportamiento específico de la app, etc.

```bash
# 1. Inicializar si no está clonado
git submodule update --init vendor/koinos/koinos-mempool

# 2. Ir al directorio del servicio y trabajar en knodel-patches
cd vendor/koinos/koinos-mempool
git checkout knodel-patches

# 3. Hacer los cambios
# ... editar archivos ...

# 4. Commit y push al fork
git add .
git commit -m "feat: descripción del cambio"
git push origin knodel-patches

# 5. Volver a Knodel y actualizar el puntero del submodulo
cd /Users/pgarcgo/code/knodel
git add vendor/koinos/koinos-mempool
git commit -m "chore(mempool): update submodule to include <descripción>"
```

---

### 3. Contribuir un fix al upstream oficial

Cambios genéricos que benefician a cualquier usuario de Koinos: bug fixes,
compatibilidad con nuevas versiones de Go/OS, mejoras de rendimiento, etc.

```bash
# 1. Inicializar y situarse en master (base limpia del upstream)
git submodule update --init vendor/koinos/koinos-mempool
cd vendor/koinos/koinos-mempool
git checkout master

# 2. Crear rama específica para el PR
git checkout -b fix/descripcion-del-fix

# 3. Hacer los cambios
# ... editar archivos ...

# 4. Commit con mensaje claro para el upstream
git add .
git commit -m "fix: descripción clara del problema y solución"

# 5. Push al fork
git push origin fix/descripcion-del-fix

# 6. Abrir PR hacia el upstream
gh pr create \
  --repo koinos/koinos-mempool \
  --head pgarciagon:fix/descripcion-del-fix \
  --base master \
  --title "fix: descripción del fix" \
  --body "Descripción detallada del problema y la solución."
```

---

### 4. Sincronizar el fork con el upstream tras un merge de PR

Cuando el PR ha sido mergeado en upstream, actualizar el fork y el submodulo:

```bash
cd vendor/koinos/koinos-mempool

# Añadir upstream como remote si no existe
git remote add upstream https://github.com/koinos/koinos-mempool.git

# Traer los cambios del upstream
git fetch upstream
git checkout master
git merge upstream/master
git push origin master

# Actualizar knodel-patches (rebase sobre el nuevo master)
git checkout knodel-patches
git rebase master
git push origin knodel-patches --force-with-lease

# Actualizar el puntero del submodulo en Knodel
cd /Users/pgarcgo/code/knodel
git add vendor/koinos/koinos-mempool
git commit -m "chore(mempool): sync with upstream after PR merge"
```

---

### 5. Aplicar un fix upstream también a knodel-patches

Si tienes cambios propios en `knodel-patches` y quieres incorporar un fix
que acaba de llegar al upstream:

```bash
cd vendor/koinos/koinos-mempool
git remote add upstream https://github.com/koinos/koinos-mempool.git 2>/dev/null || true
git fetch upstream
git checkout knodel-patches
git rebase upstream/master
git push origin knodel-patches --force-with-lease
```

---

## Cuándo usar cada rama

| Tipo de cambio | Rama | ¿PR upstream? |
|----------------|------|---------------|
| Bug genérico, compatibilidad OS/compilador | `fix/<nombre>` desde `master` | Sí |
| Mejora genérica de rendimiento o API | `feat/<nombre>` desde `master` | Sí |
| Integración con Knodel / Electron | `knodel-patches` | No |
| Parche de plataforma (macOS ARM64, Windows) | `fix/<nombre>` desde `master` | Sí, si es genérico |
| Config local, rutas, comportamiento de la app | `knodel-patches` | No |

---

## Decisión: ¿contribuir upstream o no?

Pregúntate: **¿Este cambio beneficiaría a alguien que usa el servicio sin Knodel?**

- **Sí** → rama `fix/` o `feat/` limpia desde `master`, PR al upstream
- **No** → directamente en `knodel-patches`
- **Ambos** → primero hacer el PR upstream con la parte genérica, luego añadir
  la parte específica de Knodel encima en `knodel-patches`
