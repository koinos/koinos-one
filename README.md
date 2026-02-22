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
