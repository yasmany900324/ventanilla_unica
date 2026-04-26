# ventanilla_unica

MVP en Next.js para registrar y gestionar tramites ciudadanos.

## Ejecutar en local

```bash
npm install
npm run dev
```

Tambien puedes instalar en modo lockfile-first:

```bash
if [ -f package-lock.json ]; then npm ci --include=dev --no-audit; else npm install --include=dev --no-audit; fi
```

## Persistencia de datos (Vercel + Postgres/Neon)

La app usa endpoints en `app/api` y una capa de datos principal en `lib/procedureRequests.js`.

Variables de entorno requeridas:

- `POSTGRES_URL`
- `POSTGRES_URL_NON_POOLING`
- `OPENAI_API_KEY`
- `OPENAI_MODEL_INTERPRETER` (opcional, por defecto `gpt-4.1-mini`)
- `APP_DEFAULT_LOCALE` (opcional, por defecto `es`)

En Vercel estas variables se inyectan automaticamente al conectar una base de datos Neon/Postgres al proyecto.

## Endpoints

- `GET /api/ciudadano/procedures/requests`: lista tramites del ciudadano autenticado
- `POST /api/chatbot/message`: procesa un mensaje del chatbot via backend + LLM (server-side)
- `GET /api/chatbot/metrics`: metricas de embudo del chatbot (solo administradores)

## Integracion del chatbot con backend + LLM

La integracion del asistente sigue una arquitectura de control en backend:

1. El frontend envia mensajes a `POST /api/chatbot/message`.
2. El route handler valida y sanitiza la entrada.
3. El servidor usa una capa LLM para interpretar lenguaje natural y extraer datos estructurados.
4. El backend orquesta el flujo conversacional por pasos, valida datos y decide el siguiente paso.
5. Se retorna una respuesta estructurada al frontend para renderizar.

### Flujo de UI

- Vista de chat: `/asistente`
- Boton flotante del portal y accesos de home: redirigen a `/asistente`
- El chat mantiene historial local en estado del componente.
- El `sessionId` se conserva en `localStorage` para continuidad de la conversacion.

### Flujo prioritario implementado

Caso: **Trámite ciudadano**

Secuencia:
1. ubicacion
2. descripcion
3. riesgo
4. foto opcional (adjuntar o omitir)
5. resumen
6. confirmacion
7. creacion de tramite
8. cierre

### Prueba local rapida

1. Copia variables:

```bash
cp .env.example .env.local
```

2. Completa credenciales reales de OpenAI en `.env.local`.
3. Inicia app:

```bash
npm run dev
```

4. Abre `http://localhost:3000/asistente`.
5. Prueba mensajes como:
   - "Quiero iniciar un tramite"
   - "Necesito hacer un tramite"
   - "Donde consulto el estado de mi solicitud?"

Si la capa LLM no devuelve una interpretacion valida o falla por timeout/error, el backend aplica fallback deterministico y responde con repregunta controlada.

## Telemetria del embudo conversacional

El backend registra eventos del flujo conversacional para medir conversion en creacion de tramites.

- Tabla: `chatbot_telemetry_events` (si hay Postgres disponible).
- Fallback: buffer en memoria cuando no hay DB.
- Eventos instrumentados (minimos):
  - `turn_received`
  - `flow_activated`
  - `entities_accepted`
  - `entities_rejected`
  - `low_confidence_reprompt`
  - `confirmation_ready`
  - `incident_created` (evento historico: hoy se usa para confirmacion de persistencia de tramite)
  - `llm_fallback_used`
  - `cancelled`
  - `auth_required`
  - `service_error`

### Consultar metricas (solo administradores)

`GET /api/chatbot/metrics?windowDays=7`

Respuesta:
- `totals.events`
- `totals.uniqueSessions`
- `funnel.enteredIncidentFlow` (historico)
- `funnel.readyForConfirmation`
- `funnel.authRequired`
- `funnel.confirmed`
- `funnel.incidentCreated` (historico)
- `funnel.incidentCreationConversion` (historico)
