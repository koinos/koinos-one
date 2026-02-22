# Knodel

Explorador local para **Koinos** con enfoque en sincronización eficiente, indexación de bloques y estadísticas sin depender de un servicio externo.

## Idea en una frase

Knodel permite correr un explorador de Koinos **100% en local**, mantenerlo sincronizado con la red y consultar métricas de bloques/transacciones con recuperación rápida mediante backups.

## Problema que resuelve

Hoy, para analizar actividad de cadena, muchas soluciones dependen de servicios remotos o de infra compleja. Knodel busca:

- Reducir dependencia de terceros.
- Dar control total de los datos al usuario.
- Permitir análisis y operación local incluso con conectividad irregular.

## Flujo base

1. **Bootstrap inicial**
   - Sincroniza desde génesis o snapshot hasta el bloque actual.
   - Guarda el último bloque procesado.

2. **Indexación local**
   - Procesa bloques, transacciones y eventos en una base de datos local.
   - Construye vistas para búsqueda rápida y estadísticas.

3. **Sincronización incremental**
   - En cada ejecución, retoma desde el último bloque indexado.
   - Aplica solo los bloques nuevos para mantener bajo el coste de actualización.

4. **Control de desfase y recuperación**
   - Mide el gap con la altura actual de la red.
   - Si el desfase supera un umbral, activa estrategia de recuperación.

5. **Backup/restore automático**
   - Si el desfase es grande o hay corrupción del índice, restaura un backup reciente.
   - Reanuda sincronización incremental desde ese punto.

## Arquitectura MVP propuesta

- **Ingesta**: cliente RPC/gRPC para Koinos.
- **Indexador**: pipeline de procesamiento de bloques/eventos.
- **Base de datos local**: SQLite o Postgres local (según volumen esperado).
- **API local**: endpoints para consultas y métricas.
- **UI web local**: panel con estado de sincronización y exploración de bloques/tx.
- **Módulo de backups**: snapshots programados del índice + verificación de integridad.

## Métricas clave

- Altura local vs altura de red.
- TPS estimado por ventana temporal.
- Tiempo medio de bloque.
- Cuentas activas y contratos más usados.
- Latencia de sincronización.

## Próximos pasos

1. Definir stack técnico (lenguaje principal, DB, framework API/UI).
2. Implementar indexador mínimo (bloque + transacciones).
3. Exponer API local para consulta de bloques por altura/hash.
4. Añadir módulo de estadísticas básicas.
5. Incorporar backup/restore y política de recuperación por desfase.

## Estado

Proyecto en fase de definición inicial (MVP).

## Seguimiento

Este README implementa el alcance solicitado en el issue #1.


## Referencias oficiales

- Documentación de Koinos: https://koinos.io
- Backups de blockchain (Koinos Foundation CDN): https://seed.koinosfoundation.org/backups
