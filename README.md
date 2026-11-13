# stepflow

Small interactive workflow runner: sequential steps, human gates, bounded
loop-backs, `when` conditions, `parallel` blocks, shell steps, per-step models,
template parameters.

- `src/core` – engine (no pi dependency): `runWorkflow(template, state, hooks)`
- `src/adapters/cli` – `stepflow` command; pauses at human gates and exits
- `src/adapters/pi` – pi extension (`/workflow`); each step = own in-memory pi session
- `templates/` – example workflows (YAML)

## Setup

    npm install
    npm link @earendil-works/pi-coding-agent   # CLI/extension use the globally installed pi
    npm test

## CLI

    alias stepflow='node ~/stepflow/src/adapters/cli/main.ts'

    stepflow list
    stepflow run dev-flow -p APP_NAME=todo -i "a small todo CLI"      # add --dry-run to just print prompts
    # ... runs the design step, then stops at the human checkpoint and prints:
    #       what to review, where the artifact is, and the resume commands
    stepflow resume <runId> --approve            # edits you made to the artifact file are used
    stepflow resume <runId> --revise "simpler"   # re-runs the design with your feedback
    stepflow resume <runId> --abort
    stepflow status

Runs are stored in `<cwd>/.stepflow/runs/<runId>.json`; every step output is
also written as `<runId>/<step>-<iteration>.md`.

## Template format

    params:                       # {{NAME}} in prompts/commands; -p NAME=value
      APP_NAME: { required: true }
      TEST_CMD: { default: "npm test" }
    steps:
      - id: design
        model: provider/model-id  # per step; falls back to defaults.model
        prompt: "... {{APP_NAME}} {{input}}"
      - id: accept
        gate: human               # pauses; show: <stepId>; reviseTo: <stepId>; instructions: "..."
        show: design
      - id: implement
        tools: [read, edit, write, bash]
        prompt: "... {{design}} {{test.output}} {{review.notes}}"
      - id: test
        run: "{{TEST_CMD}}"       # shell step -> { exitCode, output }
        on: { when: "test.exitCode != 0", goto: implement, max: 3 }
      - id: review
        output: { verdict: "pass|fail", notes: "string" }   # structured JSON output
        on: { when: "review.verdict == fail", goto: implement, max: 2 }

- `{{step}}` is the latest output, `{{step.field}}` a field, `{{step@all}}` every iteration.
- `parallel: [ ...agent steps ]` runs steps concurrently.
- `when: "step.field == value"` skips a step unless true.

## In pi

    pi -e ./src/adapters/pi/extension.ts
    /workflow run dev-flow APP_NAME=todo build a small todo CLI
    /workflow resume

Templates are read from `.stepflow/templates/`, `workflows/` (in the project), then the built-in `templates/`.
