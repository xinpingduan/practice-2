"""开发环境的演示数据初始化。

此模块只负责补齐可重复执行的演示账号，不参与生产业务流程。
调用方必须在已打开的数据库事务和 cursor 上下文中调用本函数。
"""

from werkzeug.security import generate_password_hash

from config import DEMO_ACCOUNT_PASSWORD


DEFAULT_DEPARTMENTS = (
    "技术部", "产品部", "运营部", "市场部",
    "人力资源部", "财务部", "行政部", "生产部",
)


def seed_department_demo_accounts(cursor):
    """为每个默认部门补齐一名经理和两名员工，便于演示审批与排班流程。"""
    password_hash = generate_password_hash(DEMO_ACCOUNT_PASSWORD)
    for index, department_name in enumerate(DEFAULT_DEPARTMENTS, start=1):
        accounts = [(f"MGR{index:02d}", f"{department_name}经理", "department_admin")]
        accounts.extend(
            (f"EMP{index:02d}{employee_index}", f"{department_name}员工{employee_index}", "employee")
            for employee_index in range(1, 3)
        )
        for employee_no, name, role in accounts:
            cursor.execute("SELECT id FROM employees WHERE employee_no=%s", (employee_no,))
            if cursor.fetchone():
                continue
            cursor.execute(
                """INSERT INTO employees
                   (name, employee_no, password, phone, department, position, role, employment_status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, '在职')""",
                (
                    name, employee_no, password_hash, f"1390000{index:02d}{len(employee_no):02d}",
                    department_name, "部门经理" if role == "department_admin" else "普通员工", role,
                ),
            )

    # 人力资源部经理复用部门经理账号，减少演示账号数量。
    cursor.execute("UPDATE employees SET role='hr_admin', position='人事负责人' WHERE employee_no='MGR05'")
