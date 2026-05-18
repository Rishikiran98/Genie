from __future__ import annotations

import argparse
import json
from pathlib import Path

from dataset_builder import SplitSpec, build_sft_record, deterministic_shuffle, deterministic_split
from reward_builder import collect_negative_tactics, reward_for_transition


def write_jsonl(records: list[dict], output_path: str) -> None:
    p = Path(output_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")


def _load_trace_records(trace_path: str) -> list[dict]:
    path = Path(trace_path)
    if path.is_dir():
        traces: list[dict] = []
        for item in sorted(path.glob("*.json")):
            traces.extend(_load_trace_records(str(item)))
        for item in sorted(path.glob("*.jsonl")):
            traces.extend(_load_trace_records(str(item)))
        return traces

    if path.suffix == ".jsonl":
        traces = []
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    traces.append(json.loads(line))
        return traces

    with path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    if isinstance(payload, list):
        return payload
    return payload.get("traces", [payload])


def _build_records_from_traces(traces: list[dict], split_spec: SplitSpec, seed: int) -> list[dict]:
    records: list[dict] = []
    for idx, trace in enumerate(traces):
        trace_id = str(trace.get("trace_id") or trace.get("id") or f"trace-{idx}")
        split = deterministic_split(trace_id, split_spec, seed=seed)
        for step_index, transition in enumerate(trace.get("transitions", []) or []):
            if not transition.get("success"):
                continue
            tactic = transition.get("tactic")
            state = transition.get("state")
            if not isinstance(tactic, str) or not isinstance(state, dict):
                continue
            negatives = collect_negative_tactics(transition)
            reward = reward_for_transition(
                success=True,
                proof_complete=bool(transition.get("proof_complete")),
            )
            metadata = {
                "source": "trace_storage",
                "proof_complete": bool(transition.get("proof_complete")),
                "num_negatives": len(negatives),
            }
            records.append(
                build_sft_record(
                    state,
                    tactic,
                    reward,
                    trace_id=trace_id,
                    step_index=step_index,
                    split=split,
                    negatives=negatives,
                    metadata=metadata,
                )
            )
    return deterministic_shuffle(records, seed=seed)


def generate_dataset(trace_path: str, output_path: str, *, seed: int, split_spec: SplitSpec) -> list[dict]:
    traces = _load_trace_records(trace_path)
    records = _build_records_from_traces(traces, split_spec, seed=seed)
    write_jsonl(records, output_path)
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate SFT dataset from trace storage")
    parser.add_argument("--trace-path", required=True, help="Path to trace storage (.json/.jsonl/or dir)")
    parser.add_argument("--output", required=True, help="Output JSONL path")
    parser.add_argument("--seed", type=int, default=0, help="Seed for deterministic splits and shuffling")
    parser.add_argument("--train-ratio", type=float, default=0.9)
    parser.add_argument("--val-ratio", type=float, default=0.05)
    parser.add_argument("--test-ratio", type=float, default=0.05)
    args = parser.parse_args()

    split_spec = SplitSpec(train=args.train_ratio, val=args.val_ratio, test=args.test_ratio)
    records = generate_dataset(args.trace_path, args.output, seed=args.seed, split_spec=split_spec)
    print(f"Wrote {len(records)} SFT records to {args.output}")


if __name__ == "__main__":
    main()
