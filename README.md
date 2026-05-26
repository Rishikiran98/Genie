# Genie

Self-Learning Theorem Proving Agent.

## What this repository is

Genie is an early-stage theorem-proving agent scaffold that combines:
- Lean verification
- proof-state parsing
- tactic proposal
- beam search
- retrieval/memory
- training/evaluation utilities

## Current status

This project is currently in scaffold/MVP stage. The core modules are present, but robust Lean runtime integration and production workflows are still in progress.

## Prerequisites

- Python 3.11+ (3.12 tested in this environment)
- Lean 4 toolchain available on `PATH` as `lean`
- (Optional, later phases) Mathlib project tooling and model/provider credentials

## Quickstart

1. Clone and enter the repo:

```bash
git clone <your-fork-or-repo-url>
cd Genie
```

2. (Recommended) Create a virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate
```

3. Validate Python modules compile:

```bash
python -m py_compile $(rg --files -g '*.py')
```

4. Run the MVP entrypoint:

```bash
python main.py
```

## Expected runtime behavior

- If Lean is installed and reachable, Genie attempts to prove a simple theorem with beam search.
- If Lean is not installed, runtime currently fails when invoking `lean` (known gap addressed in future sprint tasks).

## Running tests

```bash
pytest
```

## Repository layout

- `lean_env/` — Lean execution and output parsing
- `policy_model/` — prompt and tactic generation interfaces
- `search/` — beam search and scoring logic
- `memory/` — in-memory retrieval scaffolding (pgvector adapter planned)
- `training/` — dataset/reward utilities
- `evaluation/` — benchmark metrics/helpers
- `docs/` — planning and architecture docs

## Development workflow

- Add or update tests for any code changes.
- Keep functions deterministic where possible.
- Prefer small PRs with clear scope.
- Run local checks before commit:

```bash
python -m py_compile $(rg --files -g '*.py')
pytest
```
