# WhatsApp Cloud API — configuración (Meta) y pruebas

Esta guía complementa el código en `app/api/webhooks/whatsapp`. Describe cómo obtener credenciales, registrar el webhook y probar con número de desarrollo.

## 1. App en Meta y producto WhatsApp

1. Entra a [Meta for Developers](https://developers.facebook.com/) e inicia sesión.
2. **My Apps → Create App** (tipo **Business** o el flujo que ofrezca **WhatsApp**).
3. En el panel de la app, agrega el producto **WhatsApp** si no está agregado.
4. Abre **WhatsApp → API Setup** (o **Getting started**). Ahí verás el **test phone number** y podrás generar un **temporary access token**.

## 2. Tokens y IDs que necesita esta app

| Variable | Uso |
|----------|-----|
| `WHATSAPP_VERIFY_TOKEN` | Cadena que **tú inventas** y repites en Meta al configurar el webhook (GET de verificación). |
| `WHATSAPP_ACCESS_TOKEN` | Token de la **WhatsApp Cloud API** (Graph API). En desarrollo suele ser el token temporal; en producción conviene un token de larga duración o System User. |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número de WhatsApp Business usado para enviar mensajes (aparece en **API Setup** junto a las peticiones de ejemplo). |
| `WHATSAPP_APP_SECRET` | **App Secret** de la app de Meta (Settings → Basic). Sirve para validar `X-Hub-Signature-256` en el POST del webhook. **Obligatorio en producción** en este proyecto. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` (opcional) | Solo si más adelante automatizas cosas vía Graph; el webhook actual no lo exige. |

Copia también las variables del LLM ya usadas por el asistente (`OPENAI_API_KEY`, etc.) según `.env.example`.

## 3. URL del webhook en tu despliegue

- **URL a registrar en Meta:**  
  `https://TU_DOMINIO/api/webhooks/whatsapp`
- En local, Meta no puede llamar a `localhost` directamente; usa un túnel (**ngrok**, **Cloudflare Tunnel**, etc.) que apunte a tu `npm run dev` y usa la URL https pública como callback.

### Verificación (GET)

Meta envía:

- `hub.mode=subscribe`
- `hub.verify_token=<tu WHATSAPP_VERIFY_TOKEN>`
- `hub.challenge=<número>`

El servidor responde el `hub.challenge` en texto plano si el token coincide.

### Eventos (POST)

Suscríbete a los eventos de **messages** del número WhatsApp (en la configuración del webhook en Meta: campo **messages** para WhatsApp Business Account).

El servidor:

1. Lee el cuerpo **crudo** para validar `X-Hub-Signature-256` con `WHATSAPP_APP_SECRET` (en producción es obligatorio tener secret configurado).
2. Parsea el JSON y extrae mensajes de texto entrantes.
3. Ejecuta el mismo `processAssistantTurn` que el chat web y envía la respuesta con la API de mensajes salientes.

## 4. Cómo probar con número de prueba

1. En **WhatsApp → API Setup**, añade el número de teléfono personal que Meta te pide como “recipient” de prueba (flujo de invitación por código).
2. Envía un mensaje de texto al número de negocio de prueba que muestra Meta.
3. Revisa logs del servidor si algo falla (firma, token, `phone_number_id`).

## 5. Checklist rápido

- [ ] `WHATSAPP_VERIFY_TOKEN` definido y el mismo valor en Meta.
- [ ] `WHATSAPP_ACCESS_TOKEN` válido para el `WHATSAPP_PHONE_NUMBER_ID`.
- [ ] `WHATSAPP_APP_SECRET` definido en producción (firma del POST).
- [ ] Webhook apuntando a `https://.../api/webhooks/whatsapp`.
- [ ] Suscripción a eventos **messages**.

## 6. Identidad ciudadano ↔ WhatsApp

La vinculación número ↔ usuario del portal está preparada en `lib/assistant/resolveAssistantIdentity.js` (hoy devuelve `null`). Cuando exista tabla o proveedor de verificación, implementa ahí la resolución y el asistente podrá crear incidencias como usuario autenticado.

## 7. Pruebas manuales rápidas

### Verificación GET (Meta / consola)

Con el servidor local o desplegado y `WHATSAPP_VERIFY_TOKEN` definido:

```bash
curl -sS "https://TU_HOST/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=12345"
```

La respuesta debe ser el texto `12345` y código HTTP 200.

### Chat web (regresión)

Con la app en marcha, abre el asistente en la web y envía un mensaje; debe comportarse igual que antes del refactor (misma forma JSON del `POST /api/chatbot/message`).

### POST entrante con firma

Para simular un POST firmado necesitas calcular `X-Hub-Signature-256` con HMAC-SHA256 del cuerpo crudo y el `WHATSAPP_APP_SECRET`. Lo más simple en desarrollo es dejar `NODE_ENV=development` sin `WHATSAPP_APP_SECRET` (el código acepta el webhook sin firma **solo en desarrollo** y registra un aviso en consola). En producción define siempre `WHATSAPP_APP_SECRET` y la firma será obligatoria.
