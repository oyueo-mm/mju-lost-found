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
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/images/supabaseAdmin.ts` (server) and `supabaseBrowser.ts` (client) | Supabase project URL (`https://<project-ref>.supabase.co`). Public by design -- safe in a `NEXT_PUBLIC_` var. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/lib/images/supabaseBrowser.ts` | Supabase's public anon key, used only for the browser's `uploadToSignedUrl()` call. Authorizes nothing on its own for this bucket -- every upload is separately gated by a short-lived, server-minted signed token (see the Storage section below). Safe to expose, same category as `NEXT_PUBLIC_SUPABASE_URL`. |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/lib/images/supabaseAdmin.ts` (server-only) | Bypasses Row Level Security entirely -- **never** prefix this with `NEXT_PUBLIC_`, never import `supabaseAdmin.ts` from a `"use client"` file. |

Only `@mju.ac.kr` Google accounts can sign in -- enforced server-side in `src/lib/auth/domain.ts` / the NextAuth `signIn` callback, not just hidden in the UI.

### Database

`Next.js -> Prisma -> Supabase PostgreSQL`. Prisma 7 requires an explicit driver adapter (`@prisma/adapter-pg`, wrapping `pg`/node-postgres) instead of a built-in URL-only connector -- see `src/lib/db/prisma.ts`. Prisma Migrate reads its connection from `prisma7.config.ts`, not from `schema.prisma` (Prisma 7 removed `url`/`directUrl` from the schema file itself).

### Image storage (Supabase Storage)

Post images live in Supabase Storage, not on any server filesystem (Vercel's Serverless Functions don't have a writable/persistent one anyway) and not on Vercel Blob (an earlier phase's choice, fully replaced in Phase 4).

- **Bucket**: `post-images`, **public**, `file_size_limit` 10MB, `allowed_mime_types` restricted to `image/jpeg`, `image/png`, `image/webp` (all enforced again at the storage layer, on top of the same checks in application code -- defense in depth). Created once via a direct SQL insert into `storage.buckets` (Supabase Storage's bucket registry is just a Postgres table); there's no dashboard step to repeat, but if you're setting up a **new** Supabase project for this app, run once against it:
  ```sql
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('post-images', 'post-images', true, 10485760, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;
  ```
- **Public, not signed URLs**: every post is already visible to any logged-in member (there's no per-post confidentiality boundary in this app), so a public bucket avoids the complexity of refreshing expiring signed URLs on every page view for zero actual confidentiality benefit. `LostPost.imageUrl`/`FoundPost.imageUrl` store the ready-to-display public URL string directly (same shape the legacy schema used).
- **No custom RLS policies**: uploads are authorized entirely by a short-lived, server-minted signed upload token (see below), which is minted using the **service role key** and therefore bypasses RLS regardless of what policies exist; reads on a **public** bucket bypass RLS by definition. The actual authorization logic (login, nickname set, not suspended, post ownership) lives in `POST /api/upload`, in application code -- not in a parallel Postgres-level security system.
- **Path structure**: `posts/{lost|found}/{postId}/{uuid}.{ext}` (see `src/lib/images/pathname.ts`) -- lets a path be re-validated as belonging to a specific post without a DB lookup.
- **Upload flow**: browser asks `POST /api/upload` (checked: login, nickname, suspension, post ownership, content type) for a signed upload URL/token → browser uploads the file bytes *directly* to Supabase Storage with that token (bytes never pass through the Next.js server -- Vercel's Serverless Function body-size limit is well under this app's 10MB cap) → browser calls `POST /api/posts/[id]/image` with just the resulting path, which the server re-validates (path shape, and that it actually names this post) before deriving the public URL itself and saving it.
- **Cleanup**: replacing or deleting a post's image always writes the DB first, then best-effort deletes the old Storage object after (never the other order, so a failed Storage delete can never leave a post pointing at nothing). A Storage delete failure is logged and swallowed, never surfaced as a failed post mutation.
- **Local dev**: point `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` (from Supabase Dashboard → Project Settings → API) at the same Supabase project `DATABASE_URL`/`DIRECT_URL` already use, then `npm run dev` and try uploading an image from `/lost/new` or `/found/new` -- no separate storage emulator is needed.

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
