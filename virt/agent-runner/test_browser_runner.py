import unittest
import tempfile
from pathlib import Path

from browser_runner import parse_steps, save_screenshot


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

    def test_screenshot_falls_back_when_playwright_capture_fails(self):
        class Page:
            def screenshot(self, path):
                raise RuntimeError("capture failed")

        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "shot.png"
            save_screenshot(Page(), str(path), fallback=lambda p: Path(p).write_bytes(b"png"))
            self.assertEqual(path.read_bytes(), b"png")


if __name__ == "__main__":
    unittest.main()
