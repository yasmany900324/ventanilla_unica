# ventanilla_unica

MVP en Next.js para reportar incidencias y simular su ciclo de estado.

## Ejecutar en local

```bash
npm install
npm run dev
```

## Persistencia de datos (Vercel + Postgres/Neon)

La app usa endpoints en `app/api` y una capa de datos en `lib/incidents.js`.

Variables de entorno requeridas:

- `POSTGRES_URL`
- `POSTGRES_URL_NON_POOLING`

En Vercel estas variables se inyectan automaticamente al conectar una base de datos Neon/Postgres al proyecto.

## Endpoints

- `GET /api/incidents`: lista incidencias
- `POST /api/incidents`: crea incidencia con estado inicial `recibido`
- `PATCH /api/incidents/:id/advance`: avanza estado (`recibido -> en proceso -> resuelto`)
