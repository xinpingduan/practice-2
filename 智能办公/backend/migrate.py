"""受控执行数据库结构初始化/兼容迁移，避免 WSGI worker 并发修改表结构。"""

import os


os.environ.setdefault("AUTO_INITIALIZE_DATABASE", "false")

from app import initialize_database  # noqa: E402
from config import DATABASE_CONFIG  # noqa: E402
from utils.mysql_storage import connect_database  # noqa: E402


LOCK_TIMEOUT_SECONDS = 60


def run_migrations():
    """使用 MySQL advisory lock 保证同一数据库同一时间只有一个迁移进程。"""
    lock_name = f"employee-management-migrate:{DATABASE_CONFIG['database']}"
    with connect_database(False) as lock_connection:
        with lock_connection.cursor() as cursor:
            cursor.execute("SELECT GET_LOCK(%s, %s) AS acquired", (lock_name, LOCK_TIMEOUT_SECONDS))
            result = cursor.fetchone()
            if not result or result["acquired"] != 1:
                raise RuntimeError(f"在 {LOCK_TIMEOUT_SECONDS} 秒内未取得数据库迁移锁")
            try:
                initialize_database()
            finally:
                cursor.execute("SELECT RELEASE_LOCK(%s)", (lock_name,))


if __name__ == "__main__":
    run_migrations()
    print("数据库迁移完成")
