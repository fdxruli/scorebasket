# ScoreBasket — almacenamiento local y migraciones (v9)

## Diseño

- **Dexie 4 / IndexedDB** es la base local de los cinco almacenes: equipos, jugadores, partidos, puntos y faltas.
- Se conserva el nombre `basket_control_db`, las claves autoincrementales y las versiones históricas v2–v8. No se cambian ni se destruyen datos existentes.
- **v9 solo añade índices**: `[status+createdAt]` y `[status+config.mode+createdAt]` para el historial paginado; `[matchId+quarter+createdAt]` en anotaciones y faltas para consultas cronológicas de periodo. La migración no ejecuta escrituras a registros existentes.
- `MatchesRepository` centraliza las consultas del tablero y la creación de nuevos partidos. Las lecturas se realizan dentro de una transacción de solo lectura para construir un estado coherente.
- El histórico carga inicialmente 24 registros por modalidad y crece bajo demanda, pero el contador global sigue siendo preciso. Las tarjetas activas continúan cargándose completas.
- Los nombres de equipo se recuperan mediante `bulkGet` por identificador, sin leer el directorio completo de equipos.

## Compatibilidad y seguridad operativa

- **Nunca borrar IndexedDB ni ejecutar `db.delete()` contra la base real como estrategia de actualización.**
- Las migraciones anteriores permanecen intactas; las pruebas crean y destruyen solamente bases aisladas con nombre `sb_v9_*`.
- No se recalculan puntos, faltas o historiales durante la migración v9, ya que cada modalidad tiene reglas distintas.
- No guardar respaldos sensibles sin validar versiones y contenido. La exportación/restauración integral aún no forma parte de esta entrega.
- Antes de publicar, probar sobre una **copia del perfil real** con datos v8, incluyendo partidas antiguas, series y revanchas.
- La sincronización futura a Supabase requiere IDs globales, reglas de concurrencia y cola de operaciones; **no está implementada** por esta migración.
- Las operaciones que modifican cronómetro, puntos o faltas tienen contratos propios, y todavía deben converger en una capa de dominio común.

## Pruebas

Ejecutar `npm run test`, `npm run build`, `npm run lint`. El CI actualmente ejecuta pruebas y build; ampliar el gate de lint forma parte del cierre de calidad.

Verificar migraciones v2, v6, v7 y v8 hacia v9; que los ID y enlaces sobreviven y que los índices compuestos funcionan. El test `sb14-indexeddb-v9-architecture.test.ts` cubre una base v8, el repositorio y paginación.
