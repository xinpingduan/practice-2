"""排班导入文件读取器的无数据库单元测试。"""

from io import BytesIO
from types import GeneratorType
import unittest

from werkzeug.datastructures import FileStorage

from utils.schedule_import_reader import ScheduleImportReader


def uploaded(content, filename):
    return FileStorage(stream=BytesIO(content), filename=filename)


class ScheduleImportReaderTests(unittest.TestCase):
    def setUp(self):
        self.reader = ScheduleImportReader(max_file_bytes=64, max_rows=2)

    def test_reads_utf8_and_gbk_csv(self):
        utf8_file = uploaded("员工工号,排班日期,班次名称\nEMP001,2026-08-18,早班\n".encode("utf-8"), "schedule.csv")
        rows, error = self.reader.read_rows(utf8_file)
        self.assertIsNone(error)
        self.assertEqual(rows[0]["员工工号"], "EMP001")

        gbk_file = uploaded("employee_no,work_date,shift_name\nEMP002,2026-08-19,晚班\n".encode("gb18030"), "schedule.csv")
        rows, error = self.reader.read_rows(gbk_file)
        self.assertIsNone(error)
        self.assertEqual(rows[0]["shift_name"], "晚班")

    def test_csv_reader_uses_generator(self):
        iterator = self.reader._read_csv("employee_no,work_date,shift_name\nEMP001,2026-08-18,早班\n".encode("utf-8"))
        self.assertIsInstance(iterator, GeneratorType)
        self.assertEqual(next(iterator)["employee_no"], "EMP001")

    def test_rejects_wrong_extension_missing_columns_and_oversize_file(self):
        _, error = self.reader.read_rows(uploaded(b"test", "schedule.txt"))
        self.assertEqual(error, "仅支持 .csv 或 .xlsx 文件")

        _, error = self.reader.read_rows(uploaded("员工工号,排班日期\nEMP001,2026-08-18\n".encode("utf-8"), "schedule.csv"))
        self.assertIn("缺少必需列", error)

        _, error = self.reader.read_rows(uploaded(b"x" * 65, "schedule.csv"))
        self.assertIn("不能超过", error)


if __name__ == "__main__":
    unittest.main()
