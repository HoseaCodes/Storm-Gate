## What and why

<!-- What changes, and what problem it solves. Link the issue if there is one. -->

## Verification

<!-- How you confirmed this works. Name the commands you ran or the behaviour
     you exercised -- not "tests pass". -->

## Checklist

- [ ] **PR title is a conventional commit** — `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `chore:`, `ci:`. Squash merges use the PR title as the commit message, and the released version is derived from it. `feat:` is a minor bump, `fix:`/`perf:`/`refactor:` a patch, `docs:`/`test:`/`chore:`/`ci:` cut no release. Append `!` (`feat!:`) for a breaking change.
- [ ] **Base branch is `staging`** — only release promotions target `main`.
- [ ] **Added a changeset** if this touches `packages/**` — run `npx changeset`. Without one, the package change publishes nothing.
- [ ] Tests cover the change — `npm test` for the service, `npm run test:packages` for the SDKs.

<!-- Promoting staging to main instead? Use the promotion template:
     ?expand=1&template=promotion.md -->
