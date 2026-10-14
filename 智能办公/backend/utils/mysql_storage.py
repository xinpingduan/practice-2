"""MySQL 数据访问层：统一管理连接、单条查询、列表查询和写操作。"""

import pymysql

from config import DATABASE_CONFIG


def connect_database(include_database=True):
    """创建独立的 PyMySQL 连接；迁移建库时可跳过具体数据库名。"""
    config = DATABASE_CONFIG.copy()
    if not include_database:
        config.pop("database")
    return pymysql.connect(**config)


def query_one(sql, parameters=()):
    """执行参数化查询并返回第一行；连接退出时自动释放。"""
    with connect_database() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, parameters)
            return cursor.fetchone()


def query_all(sql, parameters=()):
    """执行参数化查询并返回所有结果行。"""
    with connect_database() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, parameters)
            return cursor.fetchall()


def execute(sql, parameters=()):
    """执行单条写操作并返回 ``(lastrowid, affected_rows)``。

    ``with connect_database()`` 正常退出时由 PyMySQL 提交，异常时回滚；
    涉及多条写操作的业务流程应自行创建事务，避免部分成功。
    """
    with connect_database() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, parameters)
            return cursor.lastrowid, cursor.rowcount
