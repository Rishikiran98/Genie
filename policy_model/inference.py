from policy_model.tactic_generator import TacticGenerator


def propose_tactics(state: dict, retrieved: list[dict] | None = None, k: int = 5) -> list[str]:
    return TacticGenerator().generate(state=state, retrieved_traces=retrieved, k=k)
