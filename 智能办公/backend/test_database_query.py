import unittest
from unittest.mock import patch

from services.database_query import DatabaseQueryError, run_database_intent, run_database_query


HR_USER = {"id": 1, "employee_no": "HR001", "role": "hr_admin", "department": "人力资源部"}
MANAGER_USER = {"id": 2, "employee_no": "MGR001", "role": "department_admin", "department": "产品部"}


class DatabaseQueryTests(unittest.TestCase):
    @patch("services.database_query.query_all")
    def test_hr_query_is_read_only_limited_and_redacts_password(self, query_all):
        query_all.return_value = [{"id": 3, "name": "张三", "password": "secret"}]

        result = run_database_query(HR_USER, "SELECT * FROM employees")

        self.assertEqual(result["rows"], [{"id": 3, "name": "张三"}])
        self.assertEqual(result["tables"], ["employees"])
        sql, parameters = query_all.call_args.args
        self.assertIn("SELECT * FROM (SELECT * FROM employees) AS assistant_query_result LIMIT %s", sql)
        self.assertEqual(parameters, [200])

    @patch("services.database_query.query_all")
    def test_department_query_appends_immutable_department_scope(self, query_all):
        query_all.return_value = []

        result = run_database_query(MANAGER_USER, "SELECT id, name FROM employees WHERE name LIKE '%张%'")

        self.assertEqual(result["scope"], "产品部部门数据")
        sql, parameters = query_all.call_args.args
        self.assertIn("WHERE name LIKE '%张%' AND (employees.department = %s)", sql)
        self.assertEqual(parameters, ["产品部", 200])

    def test_write_sql_is_rejected(self):
        with self.assertRaisesRegex(DatabaseQueryError, "SELECT"):
            run_database_query(HR_USER, "DELETE FROM employees")

    def test_department_join_is_rejected(self):
        with self.assertRaisesRegex(DatabaseQueryError, "单表"):
            run_database_query(MANAGER_USER, "SELECT e.name FROM employees e JOIN schedule_assignments a ON a.employee_id=e.id")

    @patch("services.database_query.query_all")
    def test_natural_language_department_employee_query_is_scoped(self, query_all):
        query_all.return_value = [{"工号": "EMP001", "姓名": "张三", "部门": "产品部"}]

        result = run_database_intent(MANAGER_USER, "查询本部门员工")

        self.assertEqual(result["intent"], "员工信息")
        sql, parameters = query_all.call_args.args
        self.assertIn("FROM employees WHERE employees.department = %s", sql)
        self.assertEqual(parameters, ["产品部", 200])

    def test_department_manager_cannot_request_another_department(self):
        with self.assertRaisesRegex(DatabaseQueryError, "仅可查询本部门"):
            run_database_intent(MANAGER_USER, "查询技术部员工")

    @patch("services.database_query.run_database_query")
    def test_personal_schedule_is_not_routed_to_schedule_plans(self, run_query):
        self.assertIsNone(run_database_intent(MANAGER_USER, "查询我的班次"))
        run_query.assert_not_called()

    @patch("services.database_query.query_all")
    def test_natural_language_table_id_query_uses_primary_key_and_redacts_sensitive_fields(self, query_all):
        query_all.return_value = [{"id": 1, "name": "张三", "password": "secret"}]

        result = run_database_intent(HR_USER, "查询员工表 id 为 1 的用户所有信息")

        self.assertEqual(result["intent"], "员工完整信息")
        self.assertEqual(result["rows"], [{"id": 1, "name": "张三"}])
        sql, parameters = query_all.call_args.args
        self.assertIn("SELECT * FROM employees WHERE id = %s", sql)
        self.assertEqual(parameters, [1, 200])

    @patch("services.database_query.query_all", return_value=[])
    def test_id_condition_without_spaces_or_english_table_name_is_recognized(self, query_all):
        for question in ("查询员工表id=1的用户所有信息", "查询 employees 表 id为1"):
            with self.subTest(question=question):
                result = run_database_intent(HR_USER, question)
                self.assertEqual(result["intent"], "员工完整信息")


if __name__ == "__main__":
    unittest.main()
