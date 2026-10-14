"""排班时间约束的纯计算函数，便于接口、审核和单元测试复用。"""

from datetime import date, time, timedelta


def _date_value(value):
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _time_minutes(value):
    if isinstance(value, timedelta):
        return int(value.total_seconds() // 60)
    if isinstance(value, time):
        return value.hour * 60 + value.minute
    parts = str(value).split(":")
    if len(parts) < 2:
        raise ValueError("INVALID_SHIFT_TIME")
    return int(parts[0]) * 60 + int(parts[1])


def assignment_interval(assignment):
    """把普通或跨夜班次转换为可比较的绝对分钟区间。"""
    work_date = _date_value(assignment["work_date"])
    start = work_date.toordinal() * 1440 + _time_minutes(assignment["start_time"])
    end = work_date.toordinal() * 1440 + _time_minutes(assignment["end_time"])
    if end <= start:
        end += 1440
    return start, end


def find_minimum_rest_violation(assignments, minimum_rest_hours, require_candidate=False):
    """返回第一条班次重叠或休息不足记录；没有问题时返回 ``None``。"""
    minimum_minutes = round(float(minimum_rest_hours) * 60)
    if minimum_minutes <= 0:
        return None
    grouped = {}
    for assignment in assignments:
        start, end = assignment_interval(assignment)
        grouped.setdefault(int(assignment["employee_id"]), []).append((start, end, assignment))
    for employee_assignments in grouped.values():
        employee_assignments.sort(key=lambda item: (item[0], item[1]))
        previous = None
        for current in employee_assignments:
            if previous is not None:
                rest_minutes = current[0] - previous[1]
                involves_candidate = previous[2].get("_candidate") or current[2].get("_candidate")
                if rest_minutes < minimum_minutes and (not require_candidate or involves_candidate):
                    return {
                        "previous": previous[2],
                        "current": current[2],
                        "rest_minutes": rest_minutes,
                        "minimum_minutes": minimum_minutes,
                    }
                if current[1] <= previous[1]:
                    continue
            previous = current
    return None
