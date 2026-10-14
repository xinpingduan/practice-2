"""员工领域服务的无数据库单元测试。"""

import unittest

from services.employee_service import (
    EmployeePresenter,
    EmployeeRepository,
    ListFieldNormalizer,
    OnboardingPolicy,
)


class EmployeeServiceTests(unittest.TestCase):
    def test_onboarding_policy_uses_position_and_department(self):
        self.assertEqual(OnboardingPolicy.determine_priority("网络工程师"), "紧急")
        self.assertEqual(OnboardingPolicy.determine_onboarding_type("行政部", "网络工程师"), "账号与权限开通")
        self.assertEqual(OnboardingPolicy.determine_onboarding_type("技术部", "前端开发工程师"), "研发环境配置")
        self.assertEqual(OnboardingPolicy.determine_onboarding_type("行政部", "行政专员"), "行政入职办理")

    def test_presenter_does_not_change_database_result(self):
        employee = {"id": 1, "name": "张三", "role": "employee", "password": "secret", "metadata": {"tags": ["新人"]}}
        result = EmployeePresenter.public_employee(employee)

        self.assertNotIn("password", result)
        self.assertEqual(result["role_name"], "普通员工")
        self.assertEqual(employee["password"], "secret")
        result["metadata"]["tags"].append("已处理")
        self.assertEqual(employee["metadata"]["tags"], ["新人"])

    def test_repository_and_list_normalizer(self):
        calls = []

        def fake_query_one(sql, parameters):
            calls.append((sql, parameters))
            return {"id": parameters[0]}

        repository = EmployeeRepository(fake_query_one)
        self.assertEqual(repository.find_by_id(7), {"id": 7})
        self.assertEqual(calls[0][1], (7,))
        self.assertEqual(ListFieldNormalizer.normalize([" 培训 ", "", 3], "培训项目"), (["培训", "3"], None))
        self.assertEqual(ListFieldNormalizer.normalize("培训", "培训项目"), (None, "培训项目 必须是列表"))


if __name__ == "__main__":
    unittest.main()
