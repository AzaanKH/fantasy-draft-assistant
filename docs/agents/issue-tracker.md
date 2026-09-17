# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are stored individually at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- Ticket numbers begin at `01` and follow dependency order
- Triage state is recorded as a `Status:` line near the top
- Comments and conversation history are appended under `## Comments`

## Publishing

When a skill says to publish to the issue tracker, create the appropriate file beneath `.scratch/<feature-slug>/`.

When a skill says to fetch a ticket, read the referenced local Markdown file.
