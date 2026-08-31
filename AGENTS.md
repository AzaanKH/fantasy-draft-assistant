# Project instructions

## Repository context

- Read [CONTEXT.md](CONTEXT.md) for the canonical product language before changing product behavior, specifications, tests, or interface copy.
- Respect the decisions under [docs/adr/](docs/adr/). Identify a conflict explicitly instead of silently overriding an ADR.
- Follow [docs/agents/domain.md](docs/agents/domain.md) when working with domain language or architectural decisions.
- Follow [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) when reading or writing local specifications and issues under `.scratch/`.

## Starting the app

- When asked to start, run, launch, preview, or test the full app, run `pnpm dev:live` from the repository root. This runs the live data preflight and updates the draft prep report before starting the development services. Stale rankings or player identities block startup; draft prep report failure only produces a warning.
- Use `pnpm dev` or an individual `pnpm dev:*` command only when the user explicitly asks to skip the live preflight or start one development service.
- Do not bypass the live provider settings check. After startup, the user must connect the Primary League draft so the app can confirm its current scoring and roster settings.
