"""排班导入文件的安全读取与结构校验。"""

import csv
import os
from io import BytesIO, StringIO
from itertools import islice

from openpyxl import load_workbook


class ScheduleImportReader:
    """读取 CSV/XLSX 排班文件，并统一返回字典行列表。"""

    supported_extensions = (".csv", ".xlsx")
    required_columns = (
        ("员工工号", "employee_no"),
        ("排班日期", "work_date"),
        ("班次名称", "shift_name"),
    )

    def __init__(self, max_file_bytes, max_rows=2000):
        self.max_file_bytes = max_file_bytes
        self.max_rows = max_rows

    def read_rows(self, uploaded_file):
        """读取上传文件；失败时返回 ``(None, 错误消息)``。"""
        if uploaded_file is None or not uploaded_file.filename:
            return None, "请选择要导入的 CSV 或 Excel 文件"

        extension = os.path.splitext(uploaded_file.filename)[1].lower()
        if extension not in self.supported_extensions:
            return None, "仅支持 .csv 或 .xlsx 文件"

        content = uploaded_file.read(self.max_file_bytes + 1)
        if not content:
            return None, "导入文件为空"
        if len(content) > self.max_file_bytes:
            return None, f"导入文件不能超过 {self.max_file_bytes // 1024 // 1024} MB"

        try:
            row_iterator = self._read_csv(content) if extension == ".csv" else self._read_xlsx(content)
            # 生成器按需读取：最多多取一行即可判断是否超过导入上限，避免整份文件常驻内存。
            rows = list(islice(row_iterator, self.max_rows + 1))
        except UnicodeDecodeError:
            return None, "CSV 文件编码无法识别，请使用 UTF-8 或 GBK 编码"
        except (csv.Error, ValueError):
            return None, "导入文件格式错误，请使用系统下载的模板"
        except Exception:
            return None, "无法读取 Excel 文件，请确认文件未损坏"

        if not rows:
            return None, "导入文件没有数据行"
        if len(rows) > self.max_rows:
            return None, f"单次最多导入 {self.max_rows} 条排班记录"

        missing_columns = ["/".join(names) for names in self.required_columns if not any(name in rows[0] for name in names)]
        if missing_columns:
            return None, f"导入文件缺少必需列：{'、'.join(missing_columns)}"
        return rows, None

    @staticmethod
    def _read_csv(content):
        """逐行产出 CSV 记录，而非一次性构造完整列表。"""
        for encoding in ("utf-8-sig", "utf-8", "gb18030"):
            try:
                text = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise UnicodeDecodeError("unknown", content, 0, 1, "unsupported encoding")
        return (
            row for row in csv.DictReader(StringIO(text))
            if any(str(value or "").strip() for value in row.values())
        )

    @staticmethod
    def _read_xlsx(content):
        """逐行产出 Excel 记录；迭代结束后自动关闭工作簿。"""
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
        def rows():
            try:
                worksheet = workbook.active
                values = worksheet.iter_rows(values_only=True)
                headers = next(values, None)
                if not headers:
                    return
                normalized_headers = [str(value).strip() if value is not None else "" for value in headers]
                for row in values:
                    if any(value is not None and str(value).strip() for value in row):
                        yield dict(zip(normalized_headers, row))
            finally:
                workbook.close()
        return rows()
