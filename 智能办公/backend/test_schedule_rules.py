"""排班时间硬约束的离线单元测试。"""

import unittest
from datetime import date, time, timedelta

from services.schedule_rules import assignment_interval, find_minimum_rest_violation


class ScheduleRuleTests(unittest.TestCase):
    def test_overnight_shift_interval_ends_next_day(self):
        start, end = assignment_interval({
            "work_date": date(2026, 8, 25),
            "start_time": timedelta(hours=22),
            "end_time": timedelta(hours=6),
        })
        self.assertEqual(end - start, 8 * 60)

    def test_detects_insufficient_rest_after_overnight_shift(self):
        violation = find_minimum_rest_violation([
            {"employee_id": 1, "work_date": "2026-08-25", "start_time": "22:00", "end_time": "06:00"},
            {"employee_id": 1, "work_date": "2026-08-26", "start_time": "08:00", "end_time": "17:00"},
        ], 10)
        self.assertIsNotNone(violation)
        self.assertEqual(violation["rest_minutes"], 120)

    def test_accepts_exact_minimum_and_separates_employees(self):
        violation = find_minimum_rest_violation([
            {"employee_id": 1, "work_date": "2026-08-25", "start_time": time(14), "end_time": time(22)},
            {"employee_id": 1, "work_date": "2026-08-26", "start_time": time(8), "end_time": time(17)},
            {"employee_id": 2, "work_date": "2026-08-26", "start_time": time(6), "end_time": time(15)},
        ], 10)
        self.assertIsNone(violation)

    def test_candidate_filter_ignores_unrelated_legacy_violation(self):
        violation = find_minimum_rest_violation([
            {"employee_id": 1, "work_date": "2026-08-20", "start_time": "22:00", "end_time": "06:00"},
            {"employee_id": 1, "work_date": "2026-08-21", "start_time": "08:00", "end_time": "17:00"},
            {"employee_id": 1, "work_date": "2026-08-25", "start_time": "08:00", "end_time": "17:00", "_candidate": True},
        ], 10, require_candidate=True)
        self.assertIsNone(violation)

    def test_candidate_filter_still_reports_new_violation(self):
        violation = find_minimum_rest_violation([
            {"employee_id": 1, "work_date": "2026-08-25", "start_time": "22:00", "end_time": "06:00"},
            {"employee_id": 1, "work_date": "2026-08-26", "start_time": "08:00", "end_time": "17:00", "_candidate": True},
        ], 10, require_candidate=True)
        self.assertIsNotNone(violation)


if __name__ == "__main__":
    unittest.main()
