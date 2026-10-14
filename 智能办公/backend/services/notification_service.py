"""站内消息写入与序列化：业务路由只负责决定通知谁、通知什么。"""

from utils.mysql_storage import connect_database


def serialize_notification(record):
    """将数据库时间统一输出为 ISO 字符串，供前端可靠格式化。"""
    result = record.copy()
    for field in ("created_at", "read_at"):
        value = result.get(field)
        if hasattr(value, "isoformat"):
            result[field] = value.isoformat()
    result["is_read"] = bool(result.get("is_read"))
    return result


def create_notifications(
    recipient_ids,
    notification_type,
    title,
    content,
    target_url,
    *,
    related_type="",
    related_id=None,
    dedupe_key=None,
):
    """批量创建站内消息；dedupe_key 用于避免接口重试产生重复提醒。"""
    recipients = sorted({int(recipient_id) for recipient_id in recipient_ids if recipient_id})
    if not recipients:
        return 0
    title = str(title).strip()[:120]
    content = str(content).strip()[:500]
    target_url = str(target_url).strip()[:255] or "/pages/profile.html"
    notification_type = str(notification_type).strip()[:40] or "system"
    related_type = str(related_type).strip()[:40]
    dedupe_key = str(dedupe_key).strip()[:190] if dedupe_key else None
    rows = [
        (
            recipient_id, notification_type, title, content, target_url,
            related_type, related_id, dedupe_key,
        )
        for recipient_id in recipients
    ]
    with connect_database() as connection:
        with connection.cursor() as cursor:
            cursor.executemany(
                """INSERT IGNORE INTO notifications
                   (recipient_id,notification_type,title,content,target_url,related_type,related_id,dedupe_key)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                rows,
            )
            return cursor.rowcount
