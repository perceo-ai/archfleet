import unittest

from browser_runner import parse_steps


class ParseStepsTest(unittest.TestCase):
    def test_json_array(self):
        steps = parse_steps('[{"goto":"https://x"},{"click":"#b"}]')
        self.assertEqual(len(steps), 2)
        self.assertEqual(steps[0]["goto"], "https://x")

    def test_steps_object(self):
        self.assertEqual(parse_steps('{"steps":[{"wait":100}]}'), [{"wait": 100}])

    def test_bare_url(self):
        self.assertEqual(parse_steps("https://example.com"), [{"goto": "https://example.com"}])

    def test_rejects_garbage(self):
        with self.assertRaises(ValueError):
            parse_steps("do a thing")

    def test_rejects_empty(self):
        with self.assertRaises(ValueError):
            parse_steps("   ")


if __name__ == "__main__":
    unittest.main()
