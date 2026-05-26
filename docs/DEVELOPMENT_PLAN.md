# Genie Development Plan (Phased)

This document defines a practical phased roadmap to evolve Genie from an MVP scaffold into a robust theorem proving system.

## Phase 0 — Project Baseline and Guardrails (Week 0)

### Objectives
- Establish reproducibility and engineering quality gates.
- Ensure contributors can run and validate the codebase locally.

### Scope
- Add contribution and environment setup docs.
- Add formatting/linting/testing standards.
- Add CI checks for Python syntax and unit tests.

### Deliverables
- `README.md` expanded with setup and run instructions.
- `tests/` skeleton with first parser/search tests.
- CI workflow for lint + tests.

### Exit Criteria
- New contributor can run `python main.py` and `pytest` without ambiguity.
- CI runs on every PR and blocks regressions.

---

## Phase 1 — Reliable Lean Runtime + Proof State Contract (Week 1)

### Objectives
- Make theorem execution reliable and predictable.
- Convert Lean outputs into a robust machine-readable state object.

### Scope
- Harden `LeanExecutor` error handling (missing Lean binary, timeout, compile error, tactic error).
- Expand parser to structured multi-goal support:
  - primary goal
  - all goals
  - hypotheses
  - local context
  - warnings/errors
- Add parser fixtures and golden tests.

### Deliverables
- Improved `lean_env/executor.py` and `lean_env/parser.py`.
- Unit tests covering success/failure output patterns.

### Exit Criteria
- Executor never crashes process for expected runtime failures.
- Parser handles single-goal and multi-goal outputs deterministically.

---

## Phase 2 — Search Engine Correctness (Week 2)

### Objectives
- Ensure beam search behaves correctly and efficiently.

### Scope
- Add `SearchResult` model with:
  - status (`solved`, `exhausted`, `timeout`, `error`)
  - best branch
  - explored node stats
  - failure counters
- Prevent invalid state transitions from failed tactics.
- Add normalized state hashing and duplicate pruning.
- Add global search timeout and per-run constraints.

### Deliverables
- Refactored `search/beam_search.py`, `search/state_node.py`, `search/scorer.py`.
- Unit tests with mocked executor responses.

### Exit Criteria
- Search outputs deterministic, inspectable results.
- Duplicate state explosions are bounded under configured limits.

---

## Phase 3 — Policy Layer and Tactic Generation (Week 3)

### Objectives
- Replace pure heuristic generation with configurable model-backed tactics.

### Scope
- Define strict tactic response schema (`{"tactics": [...]}`).
- Add provider interface + concrete API client implementation.
- Add malformed-output recovery and fallback policy.
- Add prompt templates with retrieved context, history, and tactical constraints.

### Deliverables
- Updated `policy_model/tactic_generator.py`, `policy_model/prompt_builder.py`, `policy_model/inference.py`.
- Configurable model settings under `configs/`.

### Exit Criteria
- Generator returns valid tactic lists across malformed/empty model responses.
- Offline tests verify schema enforcement and fallback behavior.

---

## Phase 4 — Memory and Retrieval (Week 4)

### Objectives
- Introduce durable memory to improve future theorem solving.

### Scope
- Replace placeholder in-memory store with pluggable storage:
  - in-memory for local dev
  - PostgreSQL + pgvector for persistence
- Store transitions, full traces, outcomes, and embeddings.
- Retrieve top-k similar successful transitions before tactic generation.

### Deliverables
- Real storage adapter in `memory/pgvector_store.py`.
- Retrieval quality functions in `memory/retrieval.py`.
- Migration scripts/schema docs.

### Exit Criteria
- Successful runs persist and are queryable across restarts.
- Retrieval measurably improves benchmark solve rate vs no-retrieval baseline.

---

## Phase 5 — Dataset and Training Pipeline (Weeks 5–6)

### Objectives
- Turn traces into reusable supervised training data.

### Scope
- Build dataset extraction from transition logs.
- Create train/val/test splits with versioned metadata.
- Define reward labeling and hard-negative sampling from failures.
- Export JSONL artifacts suitable for SFT.

### Deliverables
- Expanded `training/dataset_builder.py`, `training/reward_builder.py`, `training/sft_pipeline.py`.
- Dataset manifests and schema docs.

### Exit Criteria
- One reproducible dataset build command produces stable outputs.
- Dataset passes validation checks and supports model fine-tuning.

---

## Phase 6 — Evaluation Harness and Benchmarking (Week 6)

### Objectives
- Track progress with objective and repeatable metrics.

### Scope
- Add benchmark runner over curated theorem sets.
- Track metrics:
  - solve rate
  - median depth
  - invalid tactic rate
  - timeout rate
  - mean latency
- Add baseline snapshots and regression thresholds.

### Deliverables
- Enhanced `evaluation/benchmark_runner.py`, `evaluation/metrics.py`.
- Benchmark config and reports under `datasets/benchmarks/`.

### Exit Criteria
- Benchmarks are deterministic under fixed seeds.
- CI fails when metrics regress beyond threshold.

---

## Phase 7 — Service Layer, CI/CD, and Cloud Deployment (Week 7)

### Objectives
- Make Genie accessible as a managed service.

### Scope
- Expose API endpoints (`/prove`, `/jobs/{id}`, `/healthz`).
- Introduce asynchronous job orchestration.
- Add containerization and deployment workflow (staging/prod).
- Add observability (structured logs, traces, alerting).

### Deliverables
- Service module (FastAPI or equivalent).
- Dockerfile + CI/CD pipeline + deploy scripts.

### Exit Criteria
- Theorem jobs can be submitted and queried remotely.
- Deployments are repeatable with automated checks and rollback strategy.

---

## Phase 8 — Continuous Learning Loop (Week 8+)

### Objectives
- Establish a continuous improvement cycle driven by data.

### Scope
- Automate trace ingestion from production runs.
- Scheduled retraining cadence for policy model.
- Model registry/versioning and A/B benchmark validation.
- Controlled promotion of better policies.

### Deliverables
- Scheduled workflows for retraining and evaluation.
- Policy version metadata and promotion criteria.

### Exit Criteria
- New model versions are promoted only when benchmark criteria improve.
- End-to-end learning loop operates without manual intervention.

---

## Cross-Phase Technical Principles

- **Verifier-first correctness:** Lean validation is source-of-truth.
- **Strict contracts:** explicit typed objects between components.
- **Reproducibility:** deterministic seeds, versioned configs/artifacts.
- **Observability:** every proof search step is logged and attributable.
- **Graceful degradation:** fallback paths for model/storage/runtime failures.

## Program-Level Definition of Done

The project reaches production readiness when:
1. The API can solve a benchmark subset reliably with Lean-verified proofs.
2. Retrieval and learned policy outperform heuristic baseline.
3. CI/CD enforces correctness and benchmark regression gates.
4. The data-to-training-to-deployment loop is automated and auditable.
