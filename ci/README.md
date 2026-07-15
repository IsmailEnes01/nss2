# CI/CD wiring runbook

Everything in `.github/workflows/` is written and ready. Local development
needs none of this; `ci.yml` needs no secrets at all.

## What runs when

- `ci.yml` — every PR: `bun t` (typecheck), `bun check` (Biome), `bun test`.
  Works the moment the repo is pushed to GitHub.
- `preview.yml` — every PR: deploys a `lobi-pr-<N>` preview worker.
- `deploy-prod.yml` — push to main: CI → build → production deploy.

## One-time setup (deploys only)

1. Create a Cloudflare account and an API token with `Workers Scripts: Edit`
   permission (the Durable Object migration is applied automatically on first
   deploy).
2. Save it as the `CLOUDFLARE_API_TOKEN` repo secret on GitHub.
3. Optional: add a custom-domain route to `wrangler.jsonc`'s `env.production`
   block once the domain exists.

That is the entire list — there is no database, no auth provider, and no email
service to wire.

Preview cleanup (deleting `lobi-pr-<N>` workers on PR close) is intentionally
left out until the account exists; add a `preview-cleanup.yml` calling
`wrangler delete --name lobi-pr-<N>` when you wire things up.
