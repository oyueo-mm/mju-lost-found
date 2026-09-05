This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment variables

Copy `.env.example` to `.env` and fill in real values. Never commit `.env` (it's already gitignored).

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | `src/lib/db/prisma.ts` (via `@prisma/adapter-pg`) | **Pooled** PostgreSQL connection string (Supabase: the PgBouncer/"Transaction" pooler URL, typically port `6543`, with `?pgbouncer=true`). This is what the running app queries through. |
| `DIRECT_URL` | `prisma7.config.ts` (Prisma CLI: `migrate`/`db push`/introspection only) | **Unpooled** PostgreSQL connection string (Supabase: the direct connection, port `5432`). Migrate needs session-level features (advisory locks, some multi-statement DDL) the pooled connection doesn't support. Not read by the running app itself. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `src/lib/auth/auth.ts` (NextAuth's Google provider) | From a Google Cloud OAuth 2.0 Client ID. Authorized redirect URI must be `<origin>/api/auth/callback/google`. |
| `AUTH_SECRET` | NextAuth (implicit, read by the `next-auth` package itself) | Signs/encrypts the JWT session cookie. Generate with `npx auth secret` or `openssl rand -base64 32`; must be set in every environment (dev/preview/production each need their own value, or sessions from one won't validate in another). |
| `OPENROUTER_API_KEY` | `src/lib/ai/openrouter.ts` | AI text matching/embedding provider key. |
| `BLOB_READ_WRITE_TOKEN` | `src/app/api/upload/route.ts` (`@vercel/blob/client`) | Vercel Blob store token for post image uploads. |

Only `@mju.ac.kr` Google accounts can sign in -- enforced server-side in `src/lib/auth/domain.ts` / the NextAuth `signIn` callback, not just hidden in the UI.

### Database

`Next.js -> Prisma -> Supabase PostgreSQL`. Prisma 7 requires an explicit driver adapter (`@prisma/adapter-pg`, wrapping `pg`/node-postgres) instead of a built-in URL-only connector -- see `src/lib/db/prisma.ts`. Prisma Migrate reads its connection from `prisma7.config.ts`, not from `schema.prisma` (Prisma 7 removed `url`/`directUrl` from the schema file itself).

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

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
