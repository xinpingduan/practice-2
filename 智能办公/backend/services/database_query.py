"""受控的业务数据库只读查询工具。

该模块服务于智能助手的“数据库查询”模式。浏览器只提交 SQL 文本；服务端负责
角色判断、表白名单、部门数据隔离、行数限制及敏感字段剔除。它不是通用 SQL 控制台。
"""

from datetime import date, datetime, time
from decimal import Decimal
import re

from utils.mysql_storage import query_all


MAX_SQL_LENGTH = 2_000
MAX_QUERY_ROWS = 200
QUERY_ROLES = frozenset({"department_admin", "hr_admin", "super_admin"})

# 仅业务表可被查询；认证、AI 对话、使用日志与审计日志不通过该入口暴露。
BUSINESS_TABLES = frozenset({
    "employees", "onboarding_records", "employee_records", "employee_tasks",
    "admin_todos", "departments", "shift_types", "work_calendar", "scheduling_rules",
    "schedule_plans", "schedule_assignments", "schedule_plan_versions",
    "scheduling_cycles", "scheduling_cycle_change_requests", "schedule_requests",
    "notifications",
})

GLOBAL_TABLES = frozenset({"shift_types", "work_calendar", "scheduling_rules", "scheduling_cycles"})
DEPARTMENT_SCOPE = {
    "employees": "{source}.department = %s",
    "onboarding_records": "{source}.department = %s",
    "employee_records": "{source}.department = %s",
    "schedule_plans": "{source}.department = %s",
    "schedule_requests": "{source}.department = %s",
    "departments": "{source}.name = %s",
    "employee_tasks": "{source}.employee_id IN (SELECT id FROM employees WHERE department = %s)",
    "admin_todos": "{source}.employee_id IN (SELECT id FROM employees WHERE department = %s)",
    "schedule_assignments": "{source}.employee_id IN (SELECT id FROM employees WHERE department = %s)",
    "notifications": "{source}.recipient_id IN (SELECT id FROM employees WHERE department = %s)",
}

SENSITIVE_COLUMNS = frozenset({
    "password", "login_failed_attempts", "locked_until", "client_ip", "user_agent",
})

# 自然语言中常见的业务表称呼及其主键。只映射至现有白名单表，不能借此访问系统表。
TABLE_INTENTS = (
    (("employees", "employee", "users", "user", "员工表", "员工", "用户", "人员"), "employees", "id", "员工完整信息"),
    (("onboarding_records", "入职记录表", "入职记录"), "onboarding_records", "record_id", "入职记录"),
    (("employee_records", "员工档案表", "员工档案"), "employee_records", "record_id", "员工档案"),
    (("employee_tasks", "员工任务表", "员工任务", "任务"), "employee_tasks", "task_id", "员工任务"),
    (("admin_todos", "审批待办表", "审批待办", "待办"), "admin_todos", "todo_id", "审批待办"),
    (("departments", "部门表", "部门"), "departments", "department_id", "部门信息"),
    (("shift_types", "班次表", "班次类型", "班次"), "shift_types", "shift_id", "班次类型"),
    (("schedule_plans", "排班计划表", "排班计划"), "schedule_plans", "plan_id", "排班计划"),
    (("schedule_assignments", "排班明细表", "排班明细"), "schedule_assignments", "assignment_id", "排班明细"),
    (("schedule_requests", "调班申请表", "调班申请"), "schedule_requests", "request_id", "调班申请"),
    (("notifications", "通知表", "通知"), "notifications", "notification_id", "通知"),
)
FORBIDDEN_SQL = re.compile(
    r"\b(?:insert|update|delete|replace|merge|alter|drop|create|truncate|grant|revoke|"
    r"call|execute|prepare|deallocate|set|use|show|describe|explain|handler|load|outfile|"
    r"dumpfile|lock|unlock|transaction|commit|rollback|union|into|for\s+update|"
    r"information_schema|performance_schema|mysql|sys|load_file|sleep|benchmark)\b|"
    r"(?:--|#|/\*|\*/|@@|\s@)",
    re.IGNORECASE,
)
FROM_PATTERN = re.compile(
    r"\bfrom\s+`?(?P<table>[a-zA-Z_][a-zA-Z0-9_]*)`?"
    r"(?:\s+(?:as\s+)?`?(?P<alias>(?!(?:where|group|having|order|limit)\b)[a-zA-Z_][a-zA-Z0-9_]*)`?)?",
    re.IGNORECASE,
)
TABLE_PATTERN = re.compile(r"\b(?:from|join)\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?", re.IGNORECASE)
CLAUSE_PATTERN = re.compile(r"\b(?:group\s+by|having|order\s+by|limit)\b", re.IGNORECASE)


class DatabaseQueryError(ValueError):
    """可安全返回给前端的查询校验错误。"""


def _normalize_sql(sql):
    if not isinstance(sql, str):
        raise DatabaseQueryError("SQL 必须是文本")
    query = sql.strip()
    if query.endswith(";"):
        query = query[:-1].rstrip()
    if not query:
        raise DatabaseQueryError("请输入查询 SQL")
    if len(query) > MAX_SQL_LENGTH:
        raise DatabaseQueryError(f"SQL 不能超过 {MAX_SQL_LENGTH} 个字符")
    if ";" in query or not re.match(r"^select\b", query, re.IGNORECASE):
        raise DatabaseQueryError("仅支持一条 SELECT 查询")
    if FORBIDDEN_SQL.search(query):
        raise DatabaseQueryError("查询包含不允许的关键字或注释")
    return query


def _table_names(sql):
    tables = [item.lower() for item in TABLE_PATTERN.findall(sql)]
    if not tables:
        raise DatabaseQueryError("查询必须包含 FROM 业务表")
    unsupported = sorted(set(tables) - BUSINESS_TABLES)
    if unsupported:
        raise DatabaseQueryError(f"不允许查询表：{'、'.join(unsupported)}")
    return tables


def _department_scoped_query(sql, department):
    """为部门经理的单表 SELECT 注入不可绕过的部门条件。"""
    if not department:
        raise DatabaseQueryError("当前账号未绑定部门，无法执行部门数据查询")
    if re.search(r"\bjoin\b", sql, re.IGNORECASE):
        raise DatabaseQueryError("部门查询暂仅支持单表 SELECT，系统会自动限制本部门数据")
    source = FROM_PATTERN.search(sql)
    if not source:
        raise DatabaseQueryError("无法识别查询的业务表")
    table = source.group("table").lower()
    alias = (source.group("alias") or table).lower()
    if re.match(r"\s*,", sql[source.end():]):
        raise DatabaseQueryError("部门查询暂仅支持单表 SELECT，系统会自动限制本部门数据")
    if table in GLOBAL_TABLES:
        return sql, []
    rule = DEPARTMENT_SCOPE.get(table)
    if not rule:
        raise DatabaseQueryError("该业务表暂不支持部门范围查询")
    scope_sql = rule.format(source=alias)
    clause = CLAUSE_PATTERN.search(sql, source.end())
    insert_at = clause.start() if clause else len(sql)
    before, after = sql[:insert_at].rstrip(), sql[insert_at:]
    if re.search(r"\bwhere\b", before[source.end():], re.IGNORECASE):
        scoped = f"{before} AND ({scope_sql}) {after}"
    else:
        scoped = f"{before} WHERE {scope_sql} {after}"
    return scoped.strip(), [department]


def _serialize_value(value):
    if isinstance(value, (datetime, date, time)):
        return value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return "[二进制数据]"
    return value


def _safe_rows(rows):
    safe_rows = []
    for row in rows:
        safe_rows.append({
            key: _serialize_value(value)
            for key, value in row.items()
            if key.lower() not in SENSITIVE_COLUMNS
        })
    return safe_rows


def run_database_query(user, sql, initial_parameters=None):
    """执行授权后的只读 SQL，并返回适合界面表格展示的有限结果。"""
    if not user or user.get("role") not in QUERY_ROLES:
        raise DatabaseQueryError("无权限：仅部门管理员、人事和老板可以查询业务数据库")
    normalized_sql = _normalize_sql(sql)
    tables = _table_names(normalized_sql)
    parameters = list(initial_parameters or [])
    scope = "全员业务数据"
    if user["role"] == "department_admin":
        normalized_sql, parameters = _department_scoped_query(normalized_sql, user.get("department"))
        scope = f"{user['department']}部门数据"

    # 最外层统一加 LIMIT，避免用户传入大 LIMIT 或遗漏 LIMIT 导致一次读取过多记录。
    controlled_sql = f"SELECT * FROM ({normalized_sql}) AS assistant_query_result LIMIT %s"
    rows = _safe_rows(query_all(controlled_sql, [*parameters, MAX_QUERY_ROWS]))
    columns = list(rows[0].keys()) if rows else []
    return {
        "scope": scope,
        "tables": sorted(set(tables)),
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "limit": MAX_QUERY_ROWS,
    }


def run_database_intent(user, question):
    """将常见的中文业务查询意图映射到固定、可审计的只读查询。

    这里不是把用户的话直接拼成 SQL，也不允许模型生成 SQL。每一种可识别意图都
    对应服务端维护的固定语句；随后仍经过 ``run_database_query`` 的角色、部门和
    行数控制。无法可靠识别时返回 ``None``，由普通智能问答继续处理。
    """
    if not user or user.get("role") not in QUERY_ROLES:
        return None
    if not isinstance(question, str):
        return None
    text = question.strip()
    if not text:
        return None

    # 个人班次属于当前用户的授权上下文，不应进入部门管理员的排班计划查询。
    # 这里与前端分流规则形成服务端兜底，避免直接调用此接口时发生范围错误。
    if re.search(r"(?:我的|自己|个人|本人).{0,8}(?:排班|班次|班表)", text):
        return None

    # 通用“某表 id 为 N”的自然语言查询。表名来自受控词典，数值通过参数绑定，
    # SELECT * 仍会剔除密码等敏感列，并继续叠加部门管理员的范围条件。
    # 不使用单词边界：在“id为1的用户”中，中文和数字都属于 Unicode 单词字符，
    # \b 会错误地漏掉这种最常见的写法。
    id_match = re.search(r"(?i:id)\s*(?:为|是|=)?\s*(\d+)|(?:编号|主键)\s*(?:为|是|=)?\s*(\d+)", text)
    if id_match:
        record_id = int(id_match.group(1) or id_match.group(2))
        lowered = text.lower()
        for aliases, table, primary_key, intent_name in TABLE_INTENTS:
            if any(alias.lower() in lowered for alias in aliases):
                result = run_database_query(user, f"SELECT * FROM {table} WHERE {primary_key} = %s", [record_id])
                result["intent"] = intent_name
                return result

    # 仅人事和老板能按指定部门查；部门管理员只能查看自己的部门。
    requested_department = None
    match = re.search(r"(?:查询|查看|列出|统计)?\s*(本部门|[\u4e00-\u9fff]{2,10}部)(?:的)?(?:员工|人员|同事|入职|档案|排班|班次|计划)", text)
    if match and match.group(1) != "本部门":
        requested_department = match.group(1)
        if user["role"] == "department_admin" and requested_department != user.get("department"):
            raise DatabaseQueryError("部门管理员仅可查询本部门数据")

    parameters = [requested_department] if requested_department else []
    department_where = " WHERE department = %s" if requested_department else ""

    if re.search(r"员工|人员|同事|花名册", text):
        name_match = re.search(r"(?:叫|姓名(?:是|为)?)[‘\"']?([\u4e00-\u9fff]{2,20})", text)
        if not name_match:
            name_match = re.search(
                r"(?:查询|查看|查找|搜索)\s*(?:员工|人员|同事)?\s*([\u4e00-\u9fff]{2,20}?)(?=的?(?:档案|资料|信息|员工|人员|同事)|\s|[,，。；;]|$)",
                text,
            )
        name_where = ""
        if name_match:
            name_where = " WHERE name LIKE %s"
            parameters = [f"%{name_match.group(1)}%"]
        fields = "employee_no AS 工号, name AS 姓名, department AS 部门, position AS 职位, role AS 角色"
        if user["role"] in ("hr_admin", "super_admin"):
            fields += ", phone AS 手机号, email AS 邮箱, employment_status AS 在职状态"
        sql = f"SELECT {fields}, created_at AS 创建时间 FROM employees{ name_where or department_where } ORDER BY id DESC"
        result = run_database_query(user, sql, parameters)
        result["intent"] = "员工信息"
        return result

    if re.search(r"入职|待办理", text):
        sql = (
            "SELECT employee_name AS 姓名, department AS 部门, position AS 职位, "
            "onboarding_type AS 办理类型, priority AS 优先级, status AS 状态, created_at AS 创建时间 "
            "FROM onboarding_records"
            f"{department_where} ORDER BY created_at DESC"
        )
        result = run_database_query(user, sql, parameters)
        result["intent"] = "入职办理"
        return result

    if re.search(r"排班计划|排班|班次|班表", text):
        sql = (
            "SELECT name AS 计划名称, department AS 部门, start_date AS 开始日期, end_date AS 结束日期, "
            "status AS 状态, version AS 版本, updated_at AS 更新时间 FROM schedule_plans"
            f"{department_where} ORDER BY updated_at DESC"
        )
        result = run_database_query(user, sql, parameters)
        result["intent"] = "排班计划"
        return result

    if re.search(r"组织|部门列表|有哪些部门", text):
        result = run_database_query(user, "SELECT name AS 部门, description AS 说明, created_at AS 创建时间 FROM departments ORDER BY department_id")
        result["intent"] = "部门信息"
        return result

    return None
