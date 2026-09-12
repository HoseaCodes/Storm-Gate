## Release promotion: `staging` → `main`

> [!WARNING]
> **Merge this with a merge commit. Do not squash.**
>
> A squash creates a brand-new commit, so `main` never actually *contains*
> `staging`. Git stops seeing the branches as related, and every later
> promotion re-applies the same diffs and re-conflicts — permanently.

Merging this cuts a **stable release** from the `rc` versions accumulated on
`staging`, and publishes any packages with pending changesets.

## Included release candidates

<!-- Which rc versions are rolling up, e.g. 1.8.0-rc.1 through 1.8.0-rc.3. -->

## What is shipping

<!-- Summarise the user-visible changes. The generated changelog covers the
     commit detail; this is the "should we ship it" summary. -->

## Checklist

- [ ] CI is green on `staging`
- [ ] The latest `rc` was actually exercised, not just built
- [ ] Any config or env var this release needs is already in place on the target environment
- [ ] Merging with a **merge commit**, not a squash
- [ ] Breaking changes are called out above and the commit carries `!` or a `BREAKING CHANGE:` footer

## After merge

A back-merge PR (`main` → `staging`) opens automatically — merge it, also with a
merge commit. It carries the release commit back so the branches do not drift.
