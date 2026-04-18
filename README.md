# ventanilla_unica

MVP en Next.js para reportar incidencias y simular su ciclo de estado.

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

La app usa endpoints en `app/api` y una capa de datos en `lib/incidents.js`.

Variables de entorno requeridas:

- `POSTGRES_URL`
- `POSTGRES_URL_NON_POOLING`
- `DIALOGFLOW_PROJECT_ID`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `DIALOGFLOW_LANGUAGE_CODE` (opcional, por defecto `es`)

En Vercel estas variables se inyectan automaticamente al conectar una base de datos Neon/Postgres al proyecto.

## Endpoints

- `GET /api/incidents`: lista incidencias
- `POST /api/incidents`: crea incidencia con estado inicial `recibido`
- `PATCH /api/incidents/:id/advance`: avanza estado (`recibido -> en proceso -> resuelto`)
- `POST /api/chatbot/message`: procesa un mensaje del chatbot via Dialogflow (server-side)
- `GET /api/chatbot/metrics`: metricas de embudo del chatbot (solo administradores)

## Integracion del chatbot con Dialogflow

La integracion del asistente sigue una arquitectura segura para prototipo:

1. El frontend envia mensajes a `POST /api/chatbot/message`.
2. El route handler de Next.js valida y sanitiza la entrada.
3. El servidor llama a Dialogflow usando `@google-cloud/dialogflow`.
4. Se retorna una respuesta estructurada al frontend con:
   - `replyText`
   - `intent`
   - `confidence`
   - `fulfillmentMessages`
   - `action`
   - `parameters`
   - `redirectTo`
   - `redirectLabel`
   - `needsClarification`

### Flujo de UI

- Vista de chat: `/asistente`
- Boton flotante del portal y accesos de home: redirigen a `/asistente`
- El chat mantiene historial local en estado del componente.
- El `sessionId` se conserva en `localStorage` para continuidad de la conversacion.

### Mapeo de intents/actions a rutas internas

El mapeo centralizado vive en:

- `lib/chatbotIntentRoutes.js`

Ejemplos actuales:

- `crear_incidencia` -> `/asistente`
- `consultar_tramite` -> `/mis-incidencias`

Puedes extender los mapas `ACTION_ROUTE_MAP` e `INTENT_ROUTE_MAP` segun tus intents reales de Dialogflow.

### Prueba local rapida

1. Copia variables:

```bash
cp .env.example .env.local
```

2. Completa credenciales reales de Dialogflow en `.env.local`.
3. Inicia app:

```bash
npm run dev
```

4. Abre `http://localhost:3000/asistente`.
5. Prueba mensajes como:
   - "Quiero reportar un problema"
   - "Necesito hacer un tramite"
   - "Quiero crear una incidencia"
   - "Donde consulto el estado de mi solicitud?"

Si Dialogflow no detecta con buena confianza, el backend responde con `needsClarification: true` y un texto de repregunta para pedir mas contexto.

## Telemetria del embudo conversacional

El backend registra eventos del flujo conversacional para medir conversion en reporte de incidencias.

- Tabla: `chatbot_telemetry_events` (si hay Postgres disponible).
- Fallback: buffer en memoria cuando no hay DB.
- Eventos instrumentados:
  - `turn_received`
  - `intent_detected`
  - `mode_resolved`
  - `ask_field`
  - `confirmation_ready`
  - `confirmation_resumed`
  - `edit_requested`
  - `auth_required`
  - `incident_created`
  - `cancelled`
  - `fallback_clarification`
  - `redirect_offered`
  - `service_error`

### Consultar metricas (solo administradores)

`GET /api/chatbot/metrics?windowDays=7`

Respuesta:
- `totals.events`
- `totals.uniqueSessions`
- `funnel.enteredIncidentFlow`
- `funnel.readyForConfirmation`
- `funnel.authRequired`
- `funnel.confirmed`
- `funnel.incidentCreated`
- `funnel.incidentCreationConversion`
