"""将原考勤系统 att_users 中的在职员工安全导入员工管理项目。"""

from app import execute, query_all, query_one


ROLE_MAPPING = {
    2: "super_admin",
    1: "department_admin",
    0: "employee",
}


def import_active_users():
    legacy_users = query_all(
        """SELECT u.id, u.username, u.nickname, u.employee_no, u.password,
                  u.phone, u.email, u.role, u.position, d.name AS department
           FROM att_users AS u
           LEFT JOIN att_departments AS d ON d.id = u.department_id
           WHERE u.status = 1
           ORDER BY u.id"""
    )
    imported_count = 0
    skipped_count = 0
    for user in legacy_users:
        employee_no = (user["employee_no"] or f"LEGACY-{user['id']}").strip()
        if query_one("SELECT id FROM employees WHERE employee_no = %s", (employee_no,)):
            skipped_count += 1
            continue
        execute(
            """INSERT INTO employees
            (name, employee_no, password, phone, email, department, position, role)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                (user["nickname"] or user["username"]).strip(),
                employee_no,
                user["password"],
                (user["phone"] or "").strip() or "未填写",
                (user["email"] or "").strip(),
                (user["department"] or "未分配部门").strip(),
                (user["position"] or "未分配岗位").strip(),
                ROLE_MAPPING.get(user["role"], "employee"),
            ),
        )
        imported_count += 1
    print(f"导入完成：新增 {imported_count} 名员工，跳过 {skipped_count} 名重复员工。")


if __name__ == "__main__":
    import_active_users()
