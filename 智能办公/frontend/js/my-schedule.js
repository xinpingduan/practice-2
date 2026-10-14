const $ = (id) => document.getElementById(id);

let currentMonth = new Date();
let calendarSchedules = new Map();
let calendarRequests = new Map();
let leaveDays = new Set();
let activeDate = "";
let shifts = [];
let calendarMotion = "fade";
let loadVersion = 0;

const pad = (value) => String(value).padStart(2, "0");
const dateText = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const monthRange = () => {
  const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  return { start: dateText(start), end: dateText(end) };
};

function showMessage(text, type = "success") {
  const box = $("message");
  box.textContent = text;
  box.className = `message toast-message ${type}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function safeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#6366f1";
}

function statusTone(status) {
  if (String(status).includes("待")) return "pending";
  if (status === "已批准") return "approved";
  if (String(status).includes("驳回")) return "rejected";
  return "neutral";
}

function shortStatus(status) {
  const tone = statusTone(status);
  if (tone === "pending") return "审批中";
  if (tone === "approved") return "已批准";
  if (tone === "rejected") return "已驳回";
  return status || "状态未知";
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function renderCalendar() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const first = new Date(year, month, 1);
  const today = dateText(new Date());
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  $("calendar-title").textContent = `${year} 年 ${month + 1} 月`;

  let html = weekdays
    .map((day) => `<div class="calendar-weekday">周${day}</div>`).join("");
  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(year, month, index - first.getDay() + 1);
    const day = cellDate.getDate();
    const value = dateText(cellDate);
    const inCurrentMonth = cellDate.getMonth() === month;
    const schedule = calendarSchedules.get(value);
    const requests = calendarRequests.get(value) || [];
    const latestRequest = requests[0];
    const leave = leaveDays.has(value);
    const tone = latestRequest ? statusTone(latestRequest.status) : "";
    const interactive = inCurrentMonth && Boolean(schedule || latestRequest);
    const isToday = value === today;
    const isWeekend = cellDate.getDay() === 0 || cellDate.getDay() === 6;
    const statusLabel = latestRequest
      ? `${latestRequest.request_type_name} · ${shortStatus(latestRequest.status)}`
      : "";
    const cellLabel = latestRequest
      ? `${value}，${statusLabel}，点击查看申请详情`
      : schedule
        ? `${value}，${schedule.shift_name} ${schedule.start_time}至${schedule.end_time}，点击提交申请`
        : `${value}，休息`;

    let scheduleMarkup = inCurrentMonth ? '<div class="calendar-shift-row"><span class="calendar-rest-pill">休息</span></div>' : "";
    if (leave) {
      scheduleMarkup = '<div class="calendar-shift-row"><span class="calendar-shift-badge leave">请假生效</span></div>';
    } else if (schedule) {
      scheduleMarkup = `<div class="calendar-shift-row"><span class="calendar-shift-badge" style="--shift:${safeColor(schedule.color)}">${escapeHtml(schedule.shift_name)}</span><small>${escapeHtml(schedule.start_time)}–${escapeHtml(schedule.end_time)}</small></div>`;
    }

    const requestMarkup = latestRequest
      ? `<span class="calendar-request-badge ${tone}"><i aria-hidden="true"></i>${escapeHtml(statusLabel)}</span>${requests.length > 1 ? `<small class="calendar-request-count">另有 ${requests.length - 1} 条记录</small>` : ""}`
      : "";

    html += `<button class="calendar-day ${inCurrentMonth ? "current-month" : "outside-month"} ${isWeekend ? "weekend" : ""} ${isToday ? "today" : ""} ${schedule ? "scheduled" : ""} ${leave ? "on-leave" : ""} ${latestRequest ? `has-request request-${tone}` : ""}" type="button" data-date="${value}" aria-label="${escapeHtml(cellLabel)}" ${schedule ? `style="--calendar-accent:${safeColor(schedule.color)}"` : ""} ${interactive ? "" : "disabled"}><span class="calendar-date-line"><strong>${day}</strong><small class="calendar-date-weekday">周${weekdays[cellDate.getDay()]}</small>${isToday ? "<em>今天</em>" : ""}</span>${scheduleMarkup}${requestMarkup}</button>`;
  }
  const calendar = $("calendar");
  calendar.innerHTML = html;
  calendar.classList.remove("month-enter-left", "month-enter-right", "month-enter-fade", "is-loading");
  void calendar.offsetWidth;
  calendar.classList.add(`month-enter-${calendarMotion}`);
  window.setTimeout(() => calendar.classList.remove("month-enter-left", "month-enter-right", "month-enter-fade"), 380);

  const monthPrefix = `${year}-${pad(month + 1)}`;
  const currentRequests = [...calendarRequests.entries()].flatMap(([workDate, items]) => workDate.startsWith(monthPrefix) ? items : []);
  const scheduledDays = [...calendarSchedules.keys()].filter((workDate) => workDate.startsWith(monthPrefix) && !leaveDays.has(workDate)).length;
  const leaveTotal = [...leaveDays].filter((workDate) => workDate.startsWith(monthPrefix)).length;
  const pendingTotal = currentRequests.filter((item) => statusTone(item.status) === "pending").length;
  $("calendar-stats").innerHTML = `<span><strong>${scheduledDays}</strong> 个班次</span><span><strong>${leaveTotal}</strong> 天请假</span><span class="${pendingTotal ? "attention" : ""}"><strong>${pendingTotal}</strong> 项审批中</span>`;
}

function renderShiftLegend() {
  $("shift-legend-personal").innerHTML = shifts.map((item) => `<span><i style="--shift:${safeColor(item.color)}"></i>${escapeHtml(item.name)}<small>${escapeHtml(item.start_time)}–${escapeHtml(item.end_time)}</small></span>`).join("");
}

function renderRequestList(requests) {
  $("my-request-list").innerHTML = requests.map((item) => {
    const tone = statusTone(item.status);
    const workDate = String(item.work_date).slice(0, 10);
    return `<article class="request-card request-card--${tone}"><div><span class="request-status ${tone}">${escapeHtml(item.status)}</span><h3>${escapeHtml(item.request_type_name)} · ${workDate}</h3><p>${escapeHtml(item.reason)}</p></div><small>${item.desired_shift_name ? `目标班次：${escapeHtml(item.desired_shift_name)}<br>` : ""}部门意见：${escapeHtml(item.manager_note || "待处理")}${item.admin_note ? `<br>人事意见：${escapeHtml(item.admin_note)}` : ""}</small></article>`;
  }).join("") || '<p class="empty-tip">暂无申请记录。</p>';
}

function groupRequestsByDate(requests) {
  calendarRequests = new Map();
  requests.forEach((item) => {
    const workDate = String(item.work_date).slice(0, 10);
    if (!calendarRequests.has(workDate)) calendarRequests.set(workDate, []);
    calendarRequests.get(workDate).push(item);
  });
}

async function load(motion = "fade") {
  const requestVersion = ++loadVersion;
  calendarMotion = motion;
  $("calendar").classList.add("is-loading");
  const { start, end } = monthRange();
  try {
    const [result, shiftResult, requestResult] = await Promise.all([
      requestApi(`/api/my-schedule?${new URLSearchParams({ start, end })}`),
      requestApi("/api/shifts"),
      requestApi("/api/schedule-requests/mine"),
    ]);
    if (requestVersion !== loadVersion) return;
    calendarSchedules = new Map(result.schedules.map((item) => [String(item.work_date).slice(0, 10), item]));
    leaveDays = new Set(result.leave_days.map((item) => String(item.work_date).slice(0, 10)));
    shifts = shiftResult.shifts;
    groupRequestsByDate(requestResult.requests);
    renderShiftLegend();
    renderRequestList(requestResult.requests);
    renderCalendar();
  } catch (error) {
    if (requestVersion !== loadVersion) return;
    $("calendar").classList.remove("is-loading");
    showMessage(error.message, "error");
  }
}

function requestDetailMarkup(item) {
  const tone = statusTone(item.status);
  const status = String(item.status);
  const managerOpinion = item.manager_note
    || (status.includes("待部门") ? "等待部门经理审批" : null)
    || (status.includes("待人事") || item.admin_id ? "经理本人申请，无需部门审批" : "未填写审批意见");
  const adminOpinion = item.admin_note
    || (status.includes("待人事") ? "等待人事审批" : null)
    || (item.admin_id ? "未填写审批意见" : status.includes("部门已驳回") ? "申请未进入人事审批" : "本申请无需人事复审");
  return `<article class="request-detail-item ${tone}">
    <header><div><span class="request-status ${tone}">${escapeHtml(item.status)}</span><h3>${escapeHtml(item.request_type_name)}申请</h3></div><time>${escapeHtml(formatDateTime(item.created_at))}</time></header>
    <dl>
      <div><dt>申请日期</dt><dd>${String(item.work_date).slice(0, 10)}</dd></div>
      ${item.desired_shift_name ? `<div><dt>目标班次</dt><dd>${escapeHtml(item.desired_shift_name)}</dd></div>` : ""}
      <div class="wide"><dt>申请原因</dt><dd>${escapeHtml(item.reason)}</dd></div>
      <div><dt>部门审批</dt><dd>${escapeHtml(managerOpinion)}${item.manager_name ? `<small>审批人：${escapeHtml(item.manager_name)}</small>` : ""}</dd></div>
      <div><dt>人事审批</dt><dd>${escapeHtml(adminOpinion)}${item.admin_name ? `<small>审批人：${escapeHtml(item.admin_name)}</small>` : ""}</dd></div>
    </dl>
  </article>`;
}

function openRequestDetails(workDate, requests) {
  activeDate = workDate;
  $("request-detail-date").textContent = `${workDate} · 共 ${requests.length} 条申请记录`;
  $("request-detail-list").innerHTML = requests.map(requestDetailMarkup).join("");
  const hasPending = requests.some((item) => statusTone(item.status) === "pending");
  $("new-request-from-detail").hidden = hasPending || leaveDays.has(workDate) || !calendarSchedules.has(workDate);
  $("request-detail-dialog").showModal();
}

function closeRequestDetails(afterClose) {
  const dialog = $("request-detail-dialog");
  const finish = () => {
    if (!dialog.open) return;
    dialog.classList.remove("is-closing");
    dialog.close();
    if (afterClose) afterClose();
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finish();
    return;
  }
  dialog.classList.add("is-closing");
  const onAnimationEnd = (event) => {
    if (event.target !== dialog) return;
    dialog.removeEventListener("animationend", onAnimationEnd);
    finish();
  };
  dialog.addEventListener("animationend", onAnimationEnd);
  window.setTimeout(() => {
    dialog.removeEventListener("animationend", onAnimationEnd);
    finish();
  }, 320);
}

function openRequestForm(workDate) {
  const current = calendarSchedules.get(workDate);
  if (!current) return;
  activeDate = workDate;
  const alternatives = shifts.filter((item) => String(item.shift_id) !== String(current.shift_id));
  $("desired-shift").innerHTML = alternatives
    .map((item) => `<option value="${item.shift_id}">${escapeHtml(item.name)} ${escapeHtml(item.start_time)}–${escapeHtml(item.end_time)}</option>`).join("")
    || '<option value="">暂无可换班次</option>';
  $("request-type").value = "shift_change";
  $("desired-shift-label").hidden = false;
  $("request-date").textContent = `申请日期：${workDate}，当前班次：${current.shift_name}`;
  $("request-dialog").showModal();
}

$("calendar").addEventListener("click", (event) => {
  const day = event.target.closest("[data-date]");
  if (!day) return;
  const workDate = day.dataset.date;
  const requests = calendarRequests.get(workDate) || [];
  if (requests.length) {
    openRequestDetails(workDate, requests);
    return;
  }
  openRequestForm(workDate);
});

$("request-type").addEventListener("change", () => {
  $("desired-shift-label").hidden = $("request-type").value === "leave";
});

$("close-request").addEventListener("click", () => $("request-dialog").close());
$("cancel-request").addEventListener("click", () => $("request-dialog").close());
$("close-request-detail").addEventListener("click", () => closeRequestDetails());
$("close-request-detail-action").addEventListener("click", () => closeRequestDetails());
$("new-request-from-detail").addEventListener("click", () => {
  closeRequestDetails(() => openRequestForm(activeDate));
});

$("request-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = $("submit-request");
  const originalText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "提交中…";
  try {
    const result = await requestApi("/api/schedule-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_type: $("request-type").value,
        work_date: activeDate,
        desired_shift_id: $("request-type").value === "shift_change" ? $("desired-shift").value : null,
        reason: $("request-reason").value.trim(),
      }),
    });
    $("request-dialog").close();
    $("request-reason").value = "";
    await load();
    showMessage(`${result.message}，日历状态已更新`);
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalText;
  }
});

$("previous-month").addEventListener("click", () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  load("right");
});
$("next-month").addEventListener("click", () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  load("left");
});
$("today-month").addEventListener("click", () => {
  currentMonth = new Date();
  load("fade");
});

load();
