# stepflow

Small interactive workflow runner: sequential steps, human gates, bounded
loops (`on.goto`), `when` conditions, `parallel` blocks, per-step models.

- `src/core` – engine, no pi dependency (`runWorkflow(template, state, hooks)`)
- `src/adapters/cli` – dry-run terminal runner
- `src/adapters/pi` – pi extension (TODO: `/workflow` command, steps via pi SDK)
- `templates/` – example workflows (YAML)

    npm test
    npm run run -- templates/dev-flow.yaml "add a login page"
