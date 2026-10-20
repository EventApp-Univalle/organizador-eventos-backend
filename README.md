# EventApp — API Express

Proyecto académico Universidad del Valle, Proyecto Integrador I. API REST/JSON para eventos y subtareas, Hoy, capacidad configurable, conflictos y sugerencias, ejecución y progreso. Frontend React/Vite en repositorio independiente; PostgreSQL y Auth de Supabase. El frontend nunca consulta tablas directamente.

## URLs reales

- Frontend: https://miniproyecto1-front-wine.vercel.app
- API: https://eventapp-univalle-backend.onrender.com
- Swagger: https://eventapp-univalle-backend.onrender.com/api-docs/

Consultadas por solo lectura el 2026-10-19: health 200; Swagger Sprint 4 con endpoints de ejecución/progreso; sin token o con token ficticio inválido, progreso responde 401. CORS permite el frontend confirmado. Producción aún no contiene las modificaciones locales de Sprint 5. El dominio histórico `organizador-eventos-backend.onrender.com` no debe usarse para esta entrega.

## Instalación

Node **22.23.3** (`.nvmrc`, engines 22.x), npm 10.9.9 y Git.

```bash
nvm install
nvm use
npm ci
cp .env.example .env
```

Configurar solo en `.env` local o variables privadas del servicio:

```dotenv
PORT=3000
NODE_ENV=development
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=<secret-key-backend>
CORS_ORIGINS=http://localhost:5173
```

La secret key solo pertenece al backend. No publicar `.env*`, tokens, contraseñas QA ni credenciales demo. En producción `CORS_ORIGINS` es obligatorio y debe incluir orígenes HTTPS explícitos, sin rutas ni `*` (localhost HTTP solo si se autoriza y lista expresamente para QA); no hay fallback a localhost. PORT se valida y el servicio puede proporcionarlo automáticamente.

## Migraciones

Para una **base nueva y vacía**, revisar/aplicar manualmente en Supabase SQL Editor y en este orden:

1. `sql/001_initial.sql`: tablas, restricciones, RLS y permisos base; incluye usuario demo histórico de Sprint 1.
2. `sql/002_auth_profile_permissions.sql`: INSERT de perfiles para backend.
3. `sql/003_crud_permissions.sql`: permisos de edición/eliminación.
4. `sql/004_capacity_config.sql`: capacidad diaria del organizador.
5. `sql/005_subtask_execution.sql`: estado, nota y último guardado de ejecución.

En una **base existente**, inspeccionar las migraciones ya aplicadas y ejecutar solo las pendientes; no reejecutar la inicialización ni borrar datos para resolver errores. No hay migración nueva de Sprint 5. En esta ejecución no se aplicó SQL remoto. La persistencia real requiere que las cinco migraciones estén correctamente aplicadas y que el esquema de PostgREST esté actualizado.

## Ejecutar y probar

```bash
npm start
npm test
git diff --check
```

API http://localhost:3000, health `/health`, Swagger `/api-docs/`. El frontend se inicia en su terminal con `npm run dev -- --host 127.0.0.1`, puerto 5173. No existen scripts build ni lint en este backend; comprobar sintaxis con `node --check` en los JS modificados. Los tests usan mocks y HTTP local; no requieren tokens reales ni modifican Supabase remoto.

## Contrato y seguridad

OpenAPI 3 en `docs/openapi.json`, publicado mediante Swagger UI. El selector incluye Render real y localhost. Seleccionar **localhost para pruebas locales**; elegir Render solo en QA autorizado con datos de prueba.

Rutas:

- Públicas: `GET /health`, `/api-docs/`.
- Eventos: GET/POST `/api/eventos`, GET/PATCH/DELETE `/api/eventos/:id`.
- Subtareas: GET/POST `/api/eventos/:id/subtareas`, PATCH/DELETE `/api/eventos/:id/subtareas/:subtaskId`.
- Ejecución: PATCH `/api/eventos/:id/subtareas/:subtaskId/ejecucion`.
- Progreso: GET `/api/eventos/:id/progreso`, GET `/api/progreso`.
- Hoy: GET `/api/tareas/hoy?eventId=<uuid>` (filtro opcional).
- Capacidad: GET/PATCH `/api/configuracion/capacidad`.

Las privadas validan Supabase Auth con `Authorization: Bearer <access_token>` y usan exclusivamente `req.user.id`. Swagger Authorize recibe un access_token de una cuenta QA; **nunca** una secret key, contraseña ni publishable key. No se publican tokens en documentación o capturas.

Recursos ajenos responden 404; fallos técnicos devuelven JSON seguro. Los logs de las rutas afectadas registran la operación, no mensajes arbitrarios de Supabase que pudieran contener datos internos. No se implementa JWT propio ni se cambia la autenticación del Sprint 4.

PENDING y POSTPONED consumen capacidad en su fecha; DONE libera capacidad pendiente. Reactivar DONE revalida y puede responder 409 con sugerencias. Estado/nota se guardan en un UPDATE. Progreso cuenta gestiones, no horas. Ver `docs/SPRINT4.md` para reglas y límites de concurrencia.

## Render: pasos pendientes tras autorización

1. Revisar cambios y autorizar la revisión a desplegar; aquí no se hizo commit/push/PR/merge de entrega.
2. Usar el servicio existente de `EventApp-Univalle/organizador-eventos-backend`, sin crear servicios pagos. Configurar Node 22.x, Install/Build `npm ci`, Start `npm start`, Health Check `/health`.
3. Variables privadas del servicio:
   - `NODE_ENV=production`.
   - `SUPABASE_URL`: proyecto correcto.
   - `SUPABASE_SECRET_KEY`: secret key exclusivamente backend.
   - `CORS_ORIGINS=https://miniproyecto1-front-wine.vercel.app`.
   - PORT lo proporciona Render; no fijarlo a localhost ni exponer credenciales en comandos.
4. Verificar migraciones existentes, aprobar el despliegue y revisar logs sin copiar secretos a evidencias.
5. Comprobar `/health` 200, `/api-docs/` con servidor Render seleccionable, rutas protegidas 401 sin token, CORS del frontend y ausencia de acceso cruzado A/B con sesiones válidas.
6. Configurar/desplegar frontend solo después de confirmar API compatible. Variables VITE quedan descritas en su README.

No se cambiaron cuentas, DNS, variables remotas, permisos Supabase ni despliegues en esta ejecución. Los tiempos observados pueden variar por red o arranque del servicio; no hay mejora de latencia remota medida por este código local.

## Demo y QA de entrega

No hay contraseñas compartidas en este README. El coordinador prepara manualmente Demo A/Demo B, sin datos personales, y facilita sus claves temporales por canal privado. Revisar estado de Confirm email y URLs autorizadas con el responsable, sin cambiar configuración automáticamente.

Recorrido: crear evento futuro y cuatro subtareas; provocar conflicto 5+2 con límite 6; elegir propuesta y confirmar; reducir capacidad y releer impacto; marcar dos Hechas con nota → 50 %; comprobar 0/100, Pospuestas y reactivación con 409. Confirmar recarga y aislamiento A/B. No borrar datos personales ni usar credenciales privadas para una demostración pública.

Referencia de despliegue: [Node/Express en Render](https://render.com/docs/deploy-node-express-app). Evidencias técnicas y estado de revisión Sprint 5 se mantienen en el frontend `docs/sprint5/QA.md`; los repositorios continúan separados.
