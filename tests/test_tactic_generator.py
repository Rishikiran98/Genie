import unittest

from policy_model.tactic_generator import TacticGenerator


class StubClient:
    def __init__(self, response: str):
        self.response = response

    def complete(self, prompt: str) -> str:
        _ = prompt
        return self.response


class TestTacticGeneratorMalformedOutputs(unittest.TestCase):
    def test_falls_back_when_response_is_not_json(self):
        gen = TacticGenerator(client=StubClient("not-json-at-all"))
        tactics = gen.generate({"goal": "⊢ True", "hypotheses": [], "previous_steps": []}, k=2)
        self.assertEqual(tactics, ["simp", "rfl"])

    def test_repairs_embedded_json_and_filters_invalid_entries(self):
        raw = "model chatter {'tactics': ['simp', 'sorry', '  simp  ', 'rfl', '```lean exact ?_'] }"
        gen = TacticGenerator(client=StubClient(raw))
        tactics = gen.generate({"goal": "⊢ True", "hypotheses": [], "previous_steps": []}, k=5)
        self.assertEqual(tactics, ["simp", "rfl"])

    def test_uses_default_when_all_candidates_invalid_or_empty(self):
        raw = '{"tactics": ["", "   ", "sorry", "I cannot do this"]}'
        gen = TacticGenerator(client=StubClient(raw))
        tactics = gen.generate({"goal": "⊢ False", "hypotheses": [], "previous_steps": []}, k=1)
        self.assertEqual(tactics, ["simp"])


if __name__ == "__main__":
    unittest.main()
