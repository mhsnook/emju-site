# EMJU site

Marketing "business card" site for **EMJU Education & Technology Services, Pvt Ltd** — a
front page and a contact page. No auth.

## Stack

TanStack Start (React 19) + TanStack Router · Tailwind v4 + daisyUI v5 · self-hosted
Atkinson Hyperlegible / Instrument Serif / Instrument Sans · Vitest + scenetest · oxlint +
oxfmt. Deployed to **Cloudflare Workers**, leaning on Cloudflare primitives throughout:

- **D1** (`DB` binding) for contact submissions, via Drizzle ORM
- **Email Routing** (`SEND_EMAIL` binding) for the contact notification
- **Turnstile** for spam protection

The only thing crossing the network at runtime is the Turnstile widget script; everything
else is a Worker binding.

## Getting started

```bash
pnpm install        # also runs `wrangler types`
pnpm db:migrate     # create the D1 schema in the local dev database
pnpm dev            # http://localhost:3000
```

Scripts live in `package.json`. The contact form works end to end locally with no extra
setup: Turnstile uses its always-pass test keys, submissions persist to the local D1, and
the email goes through the emulated `send_email` binding.

## How it works

- **Content** is data in [`src/content/site.ts`](src/content/site.ts) (incl. the hardcoded
  projects list); edit copy there, not in JSX.
- **Contact flow** ([`src/server/contact.ts`](src/server/contact.ts)): validate →
  verify Turnstile → store in D1 → notify via `SEND_EMAIL` (with `Reply-To` set to the
  sender). Storage and email degrade gracefully when a binding is absent.

## Configuration

Bindings and non-secret vars are in [`wrangler.jsonc`](wrangler.jsonc); secrets via
`wrangler secret put`; local secrets in `.dev.vars` (see `.dev.vars.example`).

| Name                                          | Kind         | Purpose                                                              |
| --------------------------------------------- | ------------ | -------------------------------------------------------------------- |
| `DB`                                          | binding      | D1 database (contact submissions)                                    |
| `SEND_EMAIL`                                  | binding      | Email Routing send binding                                           |
| `CONTACT_NOTIFY_EMAIL`                        | secret       | Inbox that receives enquiries (a verified Email Routing destination) |
| `CONTACT_FROM_EMAIL`                          | var          | "From" address — must be on an Email-Routing-enabled domain          |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | var / secret | Turnstile keys (fall back to test keys)                              |

## PR checks

Every pull request gets one comment that reports what it _changed_, rather than whether the
repository is clean: new and resolved type errors, new and resolved lint issues, formatter
drift in the files it touched, client and Worker bundle size, and the test result. The
comment updates in place on every push.

The workflow is [`.github/workflows/pr-checks.yml`](.github/workflows/pr-checks.yml) and the
code it runs is in [`ci/`](ci). One job measures this branch, one measures the base branch,
and a third diffs the two and decides the verdict. Both jobs run the _same_ copy of `ci/`,
checked out from the pull request's head — otherwise a pull request that edits a check
script would change what the script measures. `ci/lib` is pure and its tests run in the
normal `pnpm test` suite.

What blocks a merge: new type errors, new lint errors, an unformatted file the pull request
touched, a failing test, a failed `wrangler deploy --dry-run`, and any check that produced no
measurement. Bundle sizes report without blocking.

## Deploy

```bash
wrangler d1 create emju-db     # paste the database_id into wrangler.jsonc, then:
pnpm db:migrate:prod           # apply migrations to the remote D1
wrangler login && pnpm deploy
```

Also: enable Email Routing on your domain and verify the destination inbox, then add a real
Turnstile site/secret key pair (`wrangler secret put TURNSTILE_SECRET_KEY`).

---

EMJU Education & Technology Services, Pvt Ltd — registered company in Bangalore, KA, India.
