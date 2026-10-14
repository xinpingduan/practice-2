"""独立 Output Parsers 演示的离线回归测试。"""

import unittest

from output_parser_demo import run_parser_chain


class OutputParserDemoTests(unittest.TestCase):
    def test_json_chain_returns_dictionary(self):
        result = run_parser_chain("json", "本周优先处理什么？")
        self.assertIsInstance(result, dict)
        self.assertIn("conclusion", result)

    def test_list_chain_returns_list(self):
        result = run_parser_chain("list", "本周优先处理什么？")
        self.assertIsInstance(result, list)
        self.assertGreaterEqual(len(result), 3)

    def test_xml_chain_returns_dictionary(self):
        result = run_parser_chain("xml", "本周优先处理什么？")
        self.assertIsInstance(result, dict)
        self.assertIn("response", result)


if __name__ == "__main__":
    unittest.main()
