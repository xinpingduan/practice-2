"""员工管理系统的集中配置。"""

import os
import re
from datetime import timedelta

from dotenv import load_dotenv
import pymysql


BASE_DIR = os.path.dirname(__file__)
load_dotenv(os.path.join(BASE_DIR, ".env"))

SECRET_KEY = os.getenv("FLASK_SECRET_KEY")
ENVIRONMENT = os.getenv("APP_ENV", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT == "production"


def env_flag(name, default=False):
    """读取布尔环境变量，避免字符串 ``False`` 被当作真值。"""
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_int(name, default, *, minimum=None, maximum=None):
    """读取带边界的整数配置，并在启动时给出可操作的错误信息。"""
    raw_value = os.getenv(name, str(default)).strip()
    try:
        value = int(raw_value)
    except ValueError as error:
        raise RuntimeError(f"{name} 必须是整数，当前值为 {raw_value!r}") from error
    if minimum is not None and value < minimum:
        raise RuntimeError(f"{name} 不能小于 {minimum}")
    if maximum is not None and value > maximum:
        raise RuntimeError(f"{name} 不能大于 {maximum}")
    return value


SESSION_COOKIE_SECURE = env_flag("SESSION_COOKIE_SECURE", IS_PRODUCTION)
SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "employee_management_session").strip() or "employee_management_session"
SESSION_LIFETIME = timedelta(hours=env_int("SESSION_LIFETIME_HOURS", 8, minimum=1, maximum=24 * 30))
TRUST_PROXY_HEADERS = env_flag("TRUST_PROXY_HEADERS", IS_PRODUCTION)
CREATE_DEMO_DATA = env_flag("CREATE_DEMO_DATA", False)
DEMO_ACCOUNT_PASSWORD = os.getenv("DEMO_ACCOUNT_PASSWORD", "")
AUTO_INITIALIZE_DATABASE = env_flag("AUTO_INITIALIZE_DATABASE", not IS_PRODUCTION)
APP_DEBUG = env_flag("APP_DEBUG", False) and not IS_PRODUCTION
MAX_CONTENT_LENGTH = env_int("MAX_CONTENT_LENGTH", 2 * 1024 * 1024, minimum=1024, maximum=20 * 1024 * 1024)
AI_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
AI_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "").strip()
AI_MODEL = os.getenv("MODEL", "").strip()
AGENT_API_KEY = os.getenv("AGENT_API_KEY", "").strip()
AI_ASSISTANT_ENABLED = env_flag("AI_ASSISTANT_ENABLED", True)
AI_REQUESTS_PER_WINDOW = env_int("AI_REQUESTS_PER_WINDOW", 60, minimum=1, maximum=1000)
AI_RATE_LIMIT_WINDOW_SECONDS = env_int("AI_RATE_LIMIT_WINDOW_SECONDS", 300, minimum=1, maximum=86400)
AI_MAX_HISTORY_MESSAGES = env_int("AI_MAX_HISTORY_MESSAGES", 8, minimum=2, maximum=20)
AI_MAX_STORED_MESSAGES = env_int("AI_MAX_STORED_MESSAGES", 40, minimum=AI_MAX_HISTORY_MESSAGES, maximum=100)
AI_MEMORY_TYPE = os.getenv("AI_MEMORY_TYPE", "buffer").strip().lower()
AI_MEMORY_WINDOW_MESSAGES = env_int("AI_MEMORY_WINDOW_MESSAGES", 8, minimum=1, maximum=100)
AI_MEMORY_TOKEN_LIMIT = env_int("AI_MEMORY_TOKEN_LIMIT", 4000, minimum=256, maximum=32000)
AI_MEMORY_MAX_CHARACTERS = env_int("AI_MEMORY_MAX_CHARACTERS", 16000, minimum=1000, maximum=100000)
AI_MEMORY_SUMMARY_MAX_CHARACTERS = env_int("AI_MEMORY_SUMMARY_MAX_CHARACTERS", 3000, minimum=500, maximum=12000)
AI_CONVERSATION_RETENTION_DAYS = env_int("AI_CONVERSATION_RETENTION_DAYS", 30, minimum=1, maximum=365)
DATABASE_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": env_int("DB_PORT", 3306, minimum=1, maximum=65535),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_DATABASE", "employee_management_db"),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
    "autocommit": True,
}
APP_PORT = env_int("APP_PORT", 5000, minimum=1, maximum=65535)
if not SECRET_KEY:
    raise RuntimeError("请先在 .env 中配置 FLASK_SECRET_KEY")
if IS_PRODUCTION and len(SECRET_KEY) < 32:
    raise RuntimeError("生产环境 FLASK_SECRET_KEY 至少需要 32 个字符")
if IS_PRODUCTION and DATABASE_CONFIG["user"].strip().lower() == "root":
    raise RuntimeError("生产环境 DB_USER 不能使用 root，请配置最小权限应用账号")
if IS_PRODUCTION and not DATABASE_CONFIG["password"]:
    raise RuntimeError("生产环境必须配置非空 DB_PASSWORD")
if IS_PRODUCTION and not SESSION_COOKIE_SECURE:
    raise RuntimeError("生产环境必须启用 SESSION_COOKIE_SECURE")
if IS_PRODUCTION and CREATE_DEMO_DATA:
    raise RuntimeError("生产环境禁止启用 CREATE_DEMO_DATA")
if CREATE_DEMO_DATA and len(DEMO_ACCOUNT_PASSWORD) < 12:
    raise RuntimeError("启用 CREATE_DEMO_DATA 时必须配置至少 12 位 DEMO_ACCOUNT_PASSWORD")
if not re.fullmatch(r"[A-Za-z0-9_]+", DATABASE_CONFIG["database"]):
    raise RuntimeError("DB_DATABASE 只能包含字母、数字和下划线")

PRIORITY_POSITION_KEYWORDS = ["运维", "安全", "SRE", "网络工程师"]
ROLE_NAMES = {"super_admin": "超级管理员", "hr_admin": "人事专员", "department_admin": "部门经理", "employee": "普通员工"}
MAX_LOGIN_FAILURES = 5
ACCOUNT_LOCK_MINUTES = 30
MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024
