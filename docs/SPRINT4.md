# Sprint 4: ejecución y progreso

## Preparación y migración pendiente

Código preparado sobre `6b9fc7f` (backend) y `6825c5b` (frontend), ambos con la corrección 3 integrada. No se ejecutó SQL ni QA contra Supabase real.

Antes de iniciar el backend nuevo contra Supabase, el responsable debe revisar y ejecutar **una sola vez** el contenido completo de `sql/005_subtask_execution.sql` en SQL Editor del proyecto correcto. El bloque es transaccional: agrega `status` (PENDING por defecto), `execution_note` y `execution_updated_at`. Conserva las filas y su planificación; no cambia permisos, claves ni autenticación. Si la aplicación falla por caché del esquema de PostgREST, recargar la caché desde Supabase antes del QA. No arrancar la entrega nueva sin aplicar la migración. No desplegar el frontend antes del backend compatible.

No se incorpora un historial completo. Estado, nota y timestamp se escriben juntos en un UPDATE; el timestamp registra la última escritura de ejecución. Nota omitida conserva el texto; null o texto vacío lo limpia. La interfaz envía explícitamente la nota actual.

## Reglas compartidas

- PENDING y POSTPONED consumen capacidad en su fecha objetivo. Posponer **no** mueve la fecha ni libera capacidad; debe reprogramarse explícitamente para ello.
- DONE no consume capacidad pendiente ni aparece en urgencias. Cambiar una DONE a PENDING o POSTPONED vuelve a validar capacidad y puede devolver el 409 existente, sin guardar el cambio de estado o nota.
- Todas las subtareas cuentan en totalCount. Solo DONE cuenta en doneCount. `progressPercent = doneCount / totalCount * 100`; un evento vacío tiene 0. Se entrega el cociente sin redondeo y la UI lo presenta hasta con un decimal, conservando 0/50/100 exactos. Las horas no ponderan avance.
- Hoy mantiene overdue/today/upcoming solo para PENDING. Añade done y postponed, con fecha/horas/ID ascendentes, accesibles mediante el filtro de estado de la UI. No se altera estado al navegar.
- El análisis de capacidad conserva la fecha calendario de Bogotá y excluye sobrecargas históricas; el progreso incluye todas las subtareas del evento, incluso históricas.

## API

Consultar `docs/openapi.json` y `/api-docs`. Nuevos endpoints privados:

- `PATCH /api/eventos/{id}/subtareas/{subtaskId}/ejecucion`: status obligatorio, executionNote opcional (texto hasta 2000 caracteres o null). 200 con subtarea completa confirmada; 400/401/404/409/500.
- `GET /api/eventos/{id}/progreso`: eventId, eventTitle, doneCount, totalCount, progressPercent. 200/400/401/404/500.
- `GET /api/progreso`: array del mismo resumen para todos los eventos propios, incluso vacíos; sin query. 200/400/401/500. Consultas paginadas de eventos y subtareas, sin N+1.

Las respuestas existentes de subtareas/Hoy incorporan status, executionNote, executionUpdatedAt. Los cuerpos de planificación existentes no aceptan esos campos: el cambio de ejecución usa su endpoint dedicado. No se aceptan identificadores de usuario desde el cliente. Recursos ajenos e inexistentes devuelven 404.

## Errores y límites

No se devuelve éxito si no hay fila confirmada. Un error de confirmación tras UPDATE puede dejar un resultado incierto: releer antes de reintentar. El frontend conserva borrador en fallo. La confirmación del estado y la consulta posterior del progreso son independientes: si falla esta última, se conserva el estado confirmado y se ofrece reintentar solo progreso.

Se leen todas las páginas con conteos y orden estable en progreso y detalle. No se truncan conteos ni se inventan ceros ante un fallo. Los cambios concurrentes pueden invalidar una instantánea; las comprobaciones no sustituyen aislamiento transaccional entre capacidad y escrituras, limitación heredada del Sprint 3. No se introducen RPC ni locks en esta entrega. El detalle completo crece con el número de tareas; paginación pública queda fuera del alcance actual.

## QA manual pendiente (localhost)

1. Aplicar la migración revisada; reiniciar backend y frontend en sus ramas Sprint 4. Usar usuarios QA existentes sin exponer sus sesiones.
2. Crear evento vacío: detalle y Progreso muestran 0 % y acceso a añadir subtareas.
3. Crear cuatro subtareas con esfuerzos distintos; marcar dos Hechas con nota: 2/4, 50 %. Recargar y comprobar nota, estado y timestamp Bogotá.
4. Marcar una Pospuesta: sigue en el denominador, no incrementa Hechas y aparece en Hoy solo al elegir Pospuestas. Las Hechas se encuentran con su filtro; Pendientes conservan orden Sprint 2.
5. Marcar todas Hechas: 100 %. Revertir una si cabe en capacidad: baja el porcentaje. Si no cabe, 409 y el estado previo no se pierde; reprogramar explícitamente y reintentar.
6. Crear/eliminar subtareas y comprobar conteos tras cada operación y al navegar entre Hoy, Detalle, Progreso y Configuración. Hechas liberan capacidad; Pospuestas siguen en el cálculo y advertencias.
7. Error de red y doble clic al guardar: conservar nota/estado, no duplicar escrituras. Cancelar/Escape no guarda. Fallo de GET progreso no revierte un estado ya confirmado.
8. Usuario B no ve ni cambia recursos de A; confirmar 401 y redirección sin sesión, sin divulgar tokens.
9. A 360 px y escritorio: sin desbordamiento, controles por teclado, foco al abrir/cerrar editor y barras con nombres accesibles.

## Evidencias por preparar

Capturas/video de estado+nota antes/después de recargar, barras 0/50/100, Pospuestas fuera de urgencias, capacidad coherente y aislamiento A/B. Conservar reporte real de suites, OpenAPI y QA. Registrar decisiones HCI (separar estados de urgencias; confirmar guardado y distinguir fallos de progreso), bitácora, tablero y DoD. No se presentan esas evidencias manuales como ejecutadas.
