import unittest

from desktop_runner import parse_actions


class ParseActionsTest(unittest.TestCase):
    def test_array_of_actions(self):
        acts = parse_actions('[{"click":[10,20]},{"type":"hi"},{"key":"enter"}]')
        self.assertEqual(len(acts), 3)
        self.assertEqual(acts[0]["click"], [10, 20])

    def test_actions_object(self):
        self.assertEqual(parse_actions('{"actions":[{"wait":100}]}'), [{"wait": 100}])

    def test_rejects_unknown_action(self):
        with self.assertRaises(ValueError):
            parse_actions('[{"frobnicate":1}]')

    def test_rejects_non_json(self):
        with self.assertRaises(ValueError):
            parse_actions("click the button")


if __name__ == "__main__":
    unittest.main()
