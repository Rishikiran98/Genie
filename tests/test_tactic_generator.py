from policy_model.tactic_generator import TacticGenerator


class BrokenClient:
    def complete(self, prompt: str) -> str:
        _ = prompt
        return "not-json"


def test_tactic_generator_falls_back_on_bad_json() -> None:
    generator = TacticGenerator(client=BrokenClient())
    tactics = generator.generate(state={"goal": "n + 0 = n", "hypotheses": [], "previous_steps": []})
    assert tactics == ["simp", "rfl"]
