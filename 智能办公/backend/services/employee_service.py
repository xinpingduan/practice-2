"""员工、入职与档案共用的领域服务。

本模块把与员工相关的数据和行为放进对应的类中：

* :class:`EmployeeRepository` 负责读取员工；
* :class:`OnboardingPolicy` 负责入职分类规则；
* :class:`EmployeePresenter` 负责安全地整理接口输出；
* :class:`ListFieldNormalizer` 负责档案列表字段的校验与清洗。

这样路由层只需要组织请求和响应，业务规则也有了清晰、可复用的归属。
"""

import copy
import json

from config import PRIORITY_POSITION_KEYWORDS, ROLE_NAMES
from utils.mysql_storage import query_one


class OnboardingPolicy:
    """根据部门和岗位决定入职办理类别与优先级。"""

    urgent_position_keywords = tuple(PRIORITY_POSITION_KEYWORDS)
    technical_department_keywords = ("技术", "研发", "产品")

    @classmethod
    def determine_priority(cls, position):
        """返回岗位对应的优先级。"""
        position = str(position or "")
        return "紧急" if any(keyword in position for keyword in cls.urgent_position_keywords) else "普通"

    @classmethod
    def determine_onboarding_type(cls, department, position):
        """返回员工应进入的入职办理队列。"""
        if cls.determine_priority(position) == "紧急":
            return "账号与权限开通"
        department = str(department or "")
        if any(keyword in department for keyword in cls.technical_department_keywords):
            return "研发环境配置"
        return "行政入职办理"


class EmployeeRepository:
    """员工数据读取入口，隔离调用方对 SQL 的依赖。"""

    def __init__(self, query_one_function):
        self.query_one = query_one_function

    def find_by_id(self, employee_id):
        """按主键查询一位员工，不存在时返回 ``None``。"""
        return self.query_one("SELECT * FROM employees WHERE id=%s", (employee_id,))


class EmployeePresenter:
    """将数据库员工和档案记录转换为适合 API 返回的数据。"""

    @staticmethod
    def public_employee(employee):
        """移除密码并补充可读角色名，不修改原始查询结果。"""
        if employee is None:
            return None
        # 接口输出与数据库结果完全隔离，嵌套字段也不会被调用方意外修改。
        result = copy.deepcopy(employee)
        result.pop("password", None)
        result["role_name"] = ROLE_NAMES.get(result["role"], result["role"])
        return result

    @staticmethod
    def serialize_record(record):
        """将 JSON 字段解析为列表，并补充角色显示名。"""
        if record is None:
            return None
        result = copy.deepcopy(record)
        result["training_items"] = json.loads(result["training_items"])
        result["assets"] = json.loads(result["assets"])
        result["role_name"] = ROLE_NAMES.get(result["role"], result["role"])
        return result


class ListFieldNormalizer:
    """档案中列表字段的输入校验工具。"""

    @staticmethod
    def normalize(value, field_name):
        if not isinstance(value, list):
            return None, f"{field_name} 必须是列表"
        return [str(item).strip() for item in value if str(item).strip()], None


# 保留以下函数作为兼容入口，避免已有路由或教学示例因重构而失效。
_employee_repository = EmployeeRepository(query_one)


def determine_priority(position):
    return OnboardingPolicy.determine_priority(position)


def determine_onboarding_type(department, position):
    return OnboardingPolicy.determine_onboarding_type(department, position)


def public_employee(employee):
    return EmployeePresenter.public_employee(employee)


def find_employee(employee_id):
    return _employee_repository.find_by_id(employee_id)


def serialize_record(record):
    return EmployeePresenter.serialize_record(record)


def normalize_list(value, field_name):
    return ListFieldNormalizer.normalize(value, field_name)
