# Domain Docs

How the engineering skills should consume this repo's domain documentation
when exploring the codebase. The layout is single-context.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If either is missing an entry you need, **proceed silently**. The
`/domain-modeling` skill (reached via `/grill-with-docs` and
`/improve-codebase-architecture`) adds terms and decisions as they get
resolved.

## File structure

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-get-addons-widened-qam.md
│   └── 0002-get-addons-browse-bar.md
├── backend/src/
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor
proposal, a hypothesis, a test name), use the term as defined in
`GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either
you're inventing language the project doesn't use (reconsider) or there's a
real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0001 (Get Addons widened QAM), but worth reopening because…_
