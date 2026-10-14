"""首次部署时创建唯一超级管理员。

仅在 employees 表中不存在超级管理员时执行成功。密码不会写入命令行历史。
"""

import getpass

from app import validate_password
from utils.mysql_storage import execute, query_one
from werkzeug.security import generate_password_hash


def prompt(label):
    value = input(f"{label}: ").strip()
    if not value:
        raise SystemExit(f"{label} 不能为空")
    return value


def main():
    if query_one("SELECT id FROM employees WHERE role='super_admin' LIMIT 1"):
        raise SystemExit("超级管理员已存在；如需重置，请按运维流程在数据库中操作。")

    name = prompt("管理员姓名")
    employee_no = prompt("管理员工号")
    phone = prompt("管理员手机号")
    email = input("管理员邮箱（可选）: ").strip()
    password = getpass.getpass("管理员密码: ")
    confirm_password = getpass.getpass("确认管理员密码: ")
    if password != confirm_password:
        raise SystemExit("两次密码不一致")
    password_error = validate_password(password)
    if password_error:
        raise SystemExit(password_error)
    if query_one("SELECT id FROM employees WHERE employee_no=%s", (employee_no,)):
        raise SystemExit("该工号已存在")
    execute(
        """INSERT INTO employees (name, employee_no, password, phone, email, role, employment_status)
           VALUES (%s,%s,%s,%s,%s,'super_admin','在职')""",
        (name, employee_no, generate_password_hash(password), phone, email),
    )
    print("超级管理员创建成功。请妥善保管凭据，并使用该账户创建人事与部门管理员。")


if __name__ == "__main__":
    main()
