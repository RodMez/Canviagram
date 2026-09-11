This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.

## Telegram bot (dev)

El bot de Telegram (F4.2) recibe updates vía webhook en `POST /api/telegram/webhook` (público por diseño, autenticado con el header `x-telegram-bot-api-secret-token`).

### 1. Configuración

En `.env.local`:

```
TELEGRAM_BOT_TOKEN=<token de @BotFather>
TELEGRAM_WEBHOOK_SECRET=<secreto aleatorio largo>
```

### 2. Exponer el servidor local

```bash
npx ngrok http 3000
# copia la URL https://xxxx.ngrok-free.app
```

### 3. Registrar el webhook

```bash
npm run telegram:set-webhook -- --url https://xxxx.ngrok-free.app/api/telegram/webhook
# opcional: --info para ver el estado, --delete para quitarlo
```

### 4. Probar

```bash
curl -X POST https://xxxx.ngrok-free.app/api/telegram/webhook \
  -H "x-telegram-bot-api-secret-token: <TELEGRAM_WEBHOOK_SECRET>" \
  -H "content-type: application/json" \
  -d '{"update_id":1,"message":{"message_id":1,"date":0,"chat":{"id":111,"type":"private","first_name":"T"},"from":{"id":222,"is_bot":false,"first_name":"T"},"text":"/start"}}'
```

Flujo completo: genera un código en Ajustes → Telegram (endpoint `POST /api/workspaces/:id/telegram/link`), envíalo al bot con `/link <código>` y luego manda un mensaje normal para crear nodos con IA.

## Administración (F5.5)

El modelo de IA se configura en runtime desde `/admin/settings` (sin redeploy), con
fallbacks automáticos y aviso por Telegram al operador. Solo `users.role = 'admin'`
puede verla; no hay UI para promover usuarios. El primer admin se asigna a mano:

```sql
UPDATE users SET role = 'admin' WHERE email = 'TU_EMAIL_AQUI';
```
