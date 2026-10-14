"""MySQL 接口回归测试：使用独立的 employee_management_test 数据库。"""

import os
import unittest
from io import BytesIO

# 必须在导入 app 前设置，避免测试数据写入开发数据库。
os.environ["DB_DATABASE"] = "employee_management_test"

# 该文件会清空专用数据库，应只在 MySQL 已就绪且由开发者明确授权时运行。
# 普通的离线单元测试不依赖 MySQL，也不会因为本机未启动服务而失败。
if os.getenv("RUN_MYSQL_INTEGRATION_TESTS") != "1":
    raise unittest.SkipTest("MySQL 集成测试已跳过；设置 RUN_MYSQL_INTEGRATION_TESTS=1 后运行。")

from app import app, execute, query_one
from services.ai_assistant import get_conversation_messages, save_conversation_exchange
from werkzeug.security import generate_password_hash

# 集成测试专用数据库仍需测试业务流程，CSRF 校验在独立的端到端环境验证。
app.config["TESTING"] = True


def assert_status(response, expected_status):
    assert response.status_code == expected_status, response.get_json()
    return response.get_json()


def clean_database():
    execute("DELETE FROM ai_conversations")
    execute("DELETE FROM notifications")
    execute("DELETE FROM schedule_requests")
    execute("DELETE FROM schedule_assignments")
    execute("DELETE FROM schedule_plan_versions")
    execute("DELETE FROM schedule_plans")
    execute("DELETE FROM admin_todos")
    execute("DELETE FROM employee_tasks")
    execute("DELETE FROM employee_records")
    execute("DELETE FROM onboarding_records")
    execute("DELETE FROM ai_usage_logs")
    execute("DELETE FROM employees")
    execute("DELETE FROM work_calendar")
    execute("DELETE FROM shift_types")
    execute("DELETE FROM departments")


def run_tests():
    clean_database()
    client = app.test_client()

    assert_status(client.get("/api/employees"), 401)
    missing_login = assert_status(client.post("/api/auth/login", json={}), 400)
    assert "employee_no" in missing_login["message"]
    execute(
        """INSERT INTO employees (name, employee_no, password, phone, role)
           VALUES (%s, %s, %s, %s, %s)""",
        ("测试人事专员", "ADMIN-TEST", generate_password_hash("AdminTest123!"), "13800000000", "hr_admin"),
    )
    admin_login = assert_status(client.post("/api/auth/login", json={"employee_no": "ADMIN-TEST", "password": "AdminTest123!"}), 200)
    assert admin_login["user"]["role"] == "hr_admin"
    admin_id = admin_login["user"]["id"]
    conversation_id = save_conversation_exchange(admin_id, None, "测试服务端会话", {
        "answer": '{"conclusion":"测试通过","suggestions":["无"],"risks":["无"]}',
        "output_format": "json",
    })
    stored_conversation, conversation_error, conversation_status = get_conversation_messages(admin_id, conversation_id)
    assert (conversation_error, conversation_status) == (None, 200)
    assert [message["role"] for message in stored_conversation["messages"]] == ["user", "assistant"]
    assert_status(client.get(f"/api/assistant/conversations/{conversation_id}"), 200)
    missing_register = assert_status(client.post("/api/employees/register", json={"name": "缺少字段"}), 400)
    assert "employee_no" in missing_register["message"]

    department = assert_status(client.post("/api/departments", json={"name": "技术部", "description": "研发与运维"}), 201)["department"]
    assert department["name"] == "技术部"
    assert_status(client.post("/api/departments", json={"name": "技术部"}), 409)
    shift = assert_status(client.post("/api/shifts", json={
        "name": "早班", "start_time": "08:00", "end_time": "17:00", "duration_hours": 8,
        "color": "#2563eb"
    }), 201)["shift"]
    assert shift["name"] == "早班"
    overnight = assert_status(client.post("/api/shifts", json={
        "name": "夜班", "start_time": "22:00", "end_time": "06:00", "duration_hours": 8,
        "color": "#4f46e5"
    }), 201)["shift"]
    assert overnight["duration_hours"] == 8
    assert_status(client.post("/api/shifts", json={
        "name": "错误夜班", "start_time": "22:00", "end_time": "06:00", "duration_hours": 9,
        "color": "#ef4444"
    }), 400)
    assert_status(client.put("/api/work-calendar", json={"work_date": "2026-08-17", "is_workday": False, "label": "调休"}), 200)
    calendar_result = assert_status(client.get("/api/work-calendar?start=2026-08-17&end=2026-08-17"), 200)
    assert calendar_result["calendar"][0]["work_date"] == "2026-08-17"
    scheduling_rule = assert_status(client.put("/api/scheduling-rules", json={"max_consecutive_days": 6, "min_rest_hours": 10, "max_daily_overtime_hours": 3, "max_monthly_overtime_hours": 36, "min_staff_per_position": 1}), 200)["rule"]
    assert float(scheduling_rule["min_rest_hours"]) == 10

    weak_password = assert_status(client.post("/api/employees/register", json={
        "name": "弱密码员工", "employee_no": "EMP10000", "password": "password",
        "confirm_password": "password", "phone": "13800138001"
    }), 400)
    assert "密码至少" in weak_password["message"]
    invalid_phone = assert_status(client.post("/api/employees/register", json={
        "name": "错误手机号员工", "employee_no": "EMP10002", "password": "Password1!",
        "confirm_password": "Password1!", "phone": "123"
    }), 400)
    assert "手机号格式无效" in invalid_phone["message"]

    employee = assert_status(client.post("/api/employees/register", json={
        "name": "测试员工", "employee_no": "EMP10001", "password": "Password1!",
        "confirm_password": "Password1!", "phone": "13800138000"
    }), 201)["employee"]
    employee_id = employee["id"]
    client.post("/api/auth/logout")
    assert_status(client.post("/api/auth/login", json={"employee_no": "EMP10001", "password": "Password1!"}), 200)
    assert_status(client.get(f"/api/assistant/conversations/{conversation_id}"), 404)
    execute("DELETE FROM ai_conversations WHERE conversation_id=%s", (conversation_id,))
    assert_status(client.get("/api/employees"), 403)
    client.post("/api/auth/logout")
    assert_status(client.post("/api/auth/login", json={"employee_no": "ADMIN-TEST", "password": "AdminTest123!"}), 200)

    for _ in range(5):
        assert_status(client.post("/api/auth/login", json={"employee_no": "EMP10001", "password": "错误密码"}), 401)
    assert_status(client.get("/api/auth/me"), 401)
    assert_status(client.post("/api/auth/login", json={"employee_no": "EMP10001", "password": "Password1!"}), 423)
    assert_status(client.post("/api/auth/login", json={"employee_no": "ADMIN-TEST", "password": "AdminTest123!"}), 200)
    assert_status(client.post("/api/employee-records", json={"employee_id": employee_id}), 400)

    assert_status(client.post("/api/onboarding", json={
        "employee_id": employee_id, "department": "技术部", "position": "前端开发工程师", "role": "employee"
    }), 201)
    execute("UPDATE onboarding_records SET status='待办理' WHERE employee_id=%s", (employee_id,))
    assert_status(client.post("/api/onboarding/handle", json={"type": "研发环境配置"}), 200)

    plan = assert_status(client.post("/api/schedule-plans", json={
        "name": "技术部 2026 年 8 月排班", "department": "技术部",
        "start_date": "2026-07-21", "end_date": "2026-08-20"
    }), 201)["plan"]
    plan_id = plan["plan_id"]
    insufficient_rest = client.post(f"/api/schedule-plans/{plan_id}/assignments", json={"assignments": [
        {"employee_id": employee_id, "shift_id": overnight["shift_id"], "work_date": "2026-08-14"},
        {"employee_id": employee_id, "shift_id": shift["shift_id"], "work_date": "2026-08-15"}
    ]})
    assert_status(insufficient_rest, 400)
    assert "少于规则要求的 10 小时" in insufficient_rest.get_json()["message"]
    assignments = assert_status(client.post(f"/api/schedule-plans/{plan_id}/assignments", json={"assignments": [
        {"employee_id": employee_id, "shift_id": shift["shift_id"], "work_date": "2026-08-18"},
        {"employee_id": employee_id, "shift_id": shift["shift_id"], "work_date": "2026-08-19"}
    ]}), 201)["assignments"]
    assert len(assignments) == 2
    assert_status(client.post(f"/api/schedule-plans/{plan_id}/assignments", json={"assignments": [
        {"employee_id": employee_id, "shift_id": shift["shift_id"], "work_date": "2026-08-18"}
    ]}), 400)
    batch = assert_status(client.post(f"/api/schedule-plans/{plan_id}/assignments/batch", json={
        "employee_ids": [employee_id], "shift_id": shift["shift_id"],
        "start_date": "2026-08-20", "end_date": "2026-08-20", "skip_rest_days": True
    }), 201)
    assert "1 条" in batch["message"]
    imported = assert_status(client.post(
        f"/api/schedule-plans/{plan_id}/assignments/import",
        data={"file": (BytesIO("员工工号,排班日期,班次名称\nEMP10001,2026-08-16,早班\n".encode("utf-8")), "schedule.csv")},
        content_type="multipart/form-data",
    ), 201)
    assert "成功导入 1 条" in imported["message"]
    department_schedule = assert_status(client.get("/api/schedule-view?department=技术部&start=2026-08-16&end=2026-08-20"), 200)
    assert len(department_schedule["schedules"]) == 4
    assert department_schedule["schedules"][0]["employee_id"] == employee_id
    board = assert_status(client.get("/api/schedule-board?department=技术部&start=2026-07-21&end=2026-08-20"), 200)
    assert len(board["employees"]) == 1
    assert len(board["assignments"]) == 4
    saved_board = assert_status(client.put("/api/schedule-board", json={
        "department": "技术部", "start_date": "2026-07-21", "end_date": "2026-08-20",
        "assignments": [{"employee_id": employee_id, "shift_id": shift["shift_id"], "work_date": work_date} for work_date in ("2026-08-16", "2026-08-18", "2026-08-19", "2026-08-20")]
    }), 200)
    assert saved_board["plan"]["plan_id"] == plan_id
    assert all(len(item["work_date"]) == 10 and item["work_date"].count("-") == 2 for item in saved_board["assignments"])
    reopened_board = assert_status(client.get("/api/schedule-board?department=技术部&start=2026-07-21&end=2026-08-20"), 200)
    assert reopened_board["plan"]["plan_id"] == plan_id and len(reopened_board["assignments"]) == 4
    cycle_summary = assert_status(client.get(f"/api/schedule-cycles/{plan['cycle_id']}/summary?department=技术部"), 200)
    department_summary = cycle_summary["departments"][0]
    assert department_summary["assignment_count"] == 0
    assert department_summary["draft_assignment_count"] == 4
    versions = assert_status(client.get(f"/api/schedule-plans/{plan_id}/versions"), 200)["versions"]
    assert versions and versions[0]["action"] == "保存草稿" and len(versions[0]["snapshot"]["assignments"]) == 4
    stale_save = client.put("/api/schedule-board", json={
        "department": "技术部", "start_date": "2026-07-21", "end_date": "2026-08-20", "version": 1,
        "assignments": [{"employee_id": employee_id, "shift_id": shift["shift_id"], "work_date": "2026-08-20"}],
    })
    assert_status(stale_save, 409)
    execute("UPDATE schedule_plans SET status='待人事审核' WHERE plan_id=%s", (plan_id,))
    assert_status(client.post(f"/api/schedule-plans/{plan_id}/publish"), 200)
    execute(
        """INSERT INTO employees (name, employee_no, password, phone, department, position, role, employment_status)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        ("技术部经理", "MGR-TEST", generate_password_hash("ManagerTest123!"), "13800000001", "技术部", "部门经理", "department_admin", "在职"),
    )
    execute("UPDATE employees SET login_failed_attempts=0, locked_until=NULL WHERE id=%s", (employee_id,))
    client.post("/api/auth/logout")
    assert_status(client.post("/api/auth/login", json={"employee_no": "EMP10001", "password": "Password1!"}), 200)
    assert_status(client.get("/api/shifts"), 200)
    personal_schedule = assert_status(client.get("/api/my-schedule?start=2026-08-18&end=2026-08-18"), 200)
    assert personal_schedule["schedules"][0]["work_date"] == "2026-08-18"
    employee_notifications = assert_status(client.get("/api/notifications"), 200)
    publish_notice = next(item for item in employee_notifications["notifications"] if item["notification_type"] == "schedule_published")
    assert employee_notifications["unread_count"] >= 1 and publish_notice["is_read"] is False
    assert_status(client.post(f"/api/notifications/{publish_notice['notification_id']}/read"), 200)
    assert_status(client.post("/api/notifications/read-all"), 200)
    assert assert_status(client.get("/api/notifications/unread-count"), 200)["unread_count"] == 0
    schedule_request = assert_status(client.post("/api/schedule-requests", json={
        "request_type": "leave", "work_date": "2026-08-18", "reason": "测试请假流程"
    }), 201)["request"]
    client.post("/api/auth/logout")
    assert_status(client.post("/api/auth/login", json={"employee_no": "MGR-TEST", "password": "ManagerTest123!"}), 200)
    manager_plan = assert_status(client.put("/api/schedule-board", json={
        "department": "技术部", "start_date": "2026-08-21", "end_date": "2026-09-20",
        "assignments": [{"employee_id": employee_id, "shift_id": shift["shift_id"], "work_date": "2026-08-21"}],
    }), 200)["plan"]
    manager_plan_id = manager_plan["plan_id"]
    assert_status(client.post(f"/api/schedule-plans/{manager_plan_id}/submit"), 200)
    assert_status(client.post(f"/api/schedule-plans/{manager_plan_id}/revoke-submission"), 200)
    assert_status(client.post(f"/api/schedule-plans/{manager_plan_id}/submit"), 200)
    client.post("/api/auth/logout")
    assert_status(client.post("/api/auth/login", json={"employee_no": "ADMIN-TEST", "password": "AdminTest123!"}), 200)
    assert_status(client.post(f"/api/schedule-plans/{manager_plan_id}/return", json={"note": "请核对 8 月 26 日的值班安排"}), 200)
    returned_plan = query_one("SELECT status, hr_note FROM schedule_plans WHERE plan_id=%s", (manager_plan_id,))
    assert returned_plan["status"] == "已打回" and returned_plan["hr_note"]
    client.post("/api/auth/logout")
    assert_status(client.post("/api/auth/login", json={"employee_no": "MGR-TEST", "password": "ManagerTest123!"}), 200)
    assert_status(client.put("/api/schedule-board", json={
        "department": "技术部", "start_date": "2026-08-21", "end_date": "2026-09-20",
        "assignments": [{"employee_id": employee_id, "shift_id": shift["shift_id"], "work_date": "2026-08-21"}],
    }), 200)
    assert_status(client.post(f"/api/schedule-plans/{manager_plan_id}/submit"), 200)
    department_request_payload = assert_status(client.get("/api/department/schedule-requests"), 200)
    department_requests = department_request_payload["requests"]
    assert any(item["request_id"] == schedule_request["request_id"] for item in department_requests)
    # 供页面区分“我可以审批”和“已转人事或已生效”的部门请假，两个范围不能混用。
    assert department_request_payload["leave_overview"]["awaiting_department_count"] == 1
    assert department_request_payload["leave_overview"]["other_active_count"] == 0
    manager_notifications = assert_status(client.get("/api/notifications?unread_only=true"), 200)
    assert any(item["related_id"] == schedule_request["request_id"] and item["notification_type"] == "schedule_request" for item in manager_notifications["notifications"])
    assert_status(client.post(f"/api/notifications/{publish_notice['notification_id']}/read"), 404)
    assert_status(client.post(f"/api/department/schedule-requests/{schedule_request['request_id']}/review", json={"decision": "同意"}), 200)
    approved_request = query_one("SELECT status FROM schedule_requests WHERE request_id=%s", (schedule_request["request_id"],))
    assert approved_request["status"] == "已批准"
    effective_board = assert_status(client.get("/api/schedule-board?department=技术部&start=2026-07-21&end=2026-08-20"), 200)
    leave_assignment = next(item for item in effective_board["assignments"] if item["work_date"] == "2026-08-18")
    assert leave_assignment["is_on_leave"] is True
    client.post("/api/auth/logout")
    assert_status(client.post("/api/auth/login", json={"employee_no": "EMP10001", "password": "Password1!"}), 200)
    approved_calendar = assert_status(client.get("/api/my-schedule?start=2026-08-18&end=2026-08-18"), 200)
    assert approved_calendar["leave_days"] and approved_calendar["schedules"]
    request_result_notifications = assert_status(client.get("/api/notifications?unread_only=true"), 200)["notifications"]
    assert any(item["related_id"] == schedule_request["request_id"] and item["notification_type"] == "schedule_request_result" for item in request_result_notifications)
    unsafe_change = assert_status(client.post("/api/schedule-requests", json={
        "request_type": "shift_change", "work_date": "2026-08-19",
        "desired_shift_id": overnight["shift_id"], "reason": "测试终审批复时重新校验班间休息"
    }), 201)["request"]
    client.post("/api/auth/logout")
    assert_status(client.post("/api/auth/login", json={"employee_no": "MGR-TEST", "password": "ManagerTest123!"}), 200)
    blocked_review = assert_status(client.post(
        f"/api/department/schedule-requests/{unsafe_change['request_id']}/review", json={"decision": "同意"}
    ), 409)
    assert "休息不足" in blocked_review["message"]
    assert query_one("SELECT status FROM schedule_requests WHERE request_id=%s", (unsafe_change["request_id"],))["status"] == "待部门审批"
    client.post("/api/auth/logout")
    assert_status(client.post("/api/auth/login", json={"employee_no": "ADMIN-TEST", "password": "AdminTest123!"}), 200)
    assert_status(client.post(f"/api/schedule-plans/{plan_id}/assignments", json={"assignments": [
        {"employee_id": employee_id, "shift_id": shift["shift_id"], "work_date": "2026-08-20"}
    ]}), 409)
    assert_status(client.post(f"/api/schedule-plans/{plan_id}/withdraw"), 200)

    record = assert_status(client.post("/api/employee-records", json={
        "employee_id": employee_id, "training_items": ["入职培训", "信息安全培训"],
        "assets": ["笔记本电脑", "工牌"], "remark": "已完成归档"
    }), 201)["record"]
    record_id = record["record_id"]
    assert_status(client.get("/api/employee-records"), 200)
    updated = assert_status(client.put(f"/api/employee-records/{record_id}", json={
        "assets": ["笔记本电脑", "工牌", "显示器"], "remark": "资产已补充"
    }), 200)["record"]
    assert "显示器" in updated["assets"]
    assert_status(client.delete(f"/api/employee-records/{record_id}"), 200)
    assert_status(client.get(f"/api/employee-records/{record_id}"), 404)
    clean_database()
    print("MySQL 员工管理 API 测试全部通过。")


if __name__ == "__main__":
    run_tests()
