# stepflow

Small interactive workflow runner: sequential steps, human gates, bounded
loops (`on.goto`), `when` conditions, `parallel` blocks, per-step models.

- `src/core` – engine, no pi dependency (`runWorkflow(template, state, hooks)`)
- `src/adapters/cli` – dry-run terminal runner
- `src/adapters/pi` – pi extension (`/workflow` command; each step = own in-memory pi session)
- `templates/` – example workflows (YAML)

    npm test
    npm run run -- templates/dev-flow.yaml "add a login page"

## Use in pi

    pi -e ./src/adapters/pi/extension.ts       # try it
    pi install /home/vermes/stepflow           # or install as a package

Then: `/workflow list`, `/workflow run dev-flow add a login page`, `/workflow resume`.
Templates are read from `.stepflow/templates/`, `workflows/` (in the project), then the built-in `templates/`.
Run state: `.stepflow/runs/*.json`. Model ids in templates are `provider/model-id`; edit the placeholders.
