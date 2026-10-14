const list = document.getElementById("employee-list");
const pageSize = 15;
let employees = [];
let currentPage = 1;

function esc(value) {
  return String(value || "-").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function renderEmployees() {
  const totalPages = Math.max(Math.ceil(employees.length / pageSize), 1);
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = employees.slice(start, start + pageSize);
  list.innerHTML = pageRows.map((employee) => `<tr><td>${esc(employee.employee_no)}</td><td><strong>${esc(employee.name)}</strong></td><td>${esc(employee.department)}</td><td>${esc(employee.position)}</td><td>${esc(employee.role_name)}</td><td><span class="request-status">${esc(employee.employment_status)}</span></td><td class="records-action-col"><a class="table-button permission-link" href="employee-detail.html?id=${employee.id}">查看档案</a></td></tr>`).join("") || '<tr><td colspan="7" class="empty-tip">没有符合条件的员工，请调整筛选条件。</td></tr>';
  document.getElementById("employee-count").textContent = `共 ${employees.length} 名员工`;
  document.getElementById("page-status").textContent = `第 ${currentPage} / ${totalPages} 页`;
  document.getElementById("page-previous").disabled = currentPage <= 1;
  document.getElementById("page-next").disabled = currentPage >= totalPages;
}

async function loadEmployees() {
  const params = new URLSearchParams();
  const fields = { name: "name", "employee-no": "employee_no", department: "department", "employment-status": "employment_status" };
  Object.entries(fields).forEach(([id, parameter]) => {
    const value = document.getElementById(id).value.trim();
    if (value) params.set(parameter, value);
  });
  list.innerHTML = '<tr><td colspan="7" class="empty-tip">正在查询员工档案…</td></tr>';
  try {
    const result = await requestApi(`/api/employees?${params}`);
    employees = Array.isArray(result.employees) ? result.employees : [];
    currentPage = 1;
    renderEmployees();
  } catch (error) {
    employees = [];
    list.innerHTML = `<tr><td colspan="7" class="empty-tip">${esc(error.message)}，请稍后重试。</td></tr>`;
    document.getElementById("employee-count").textContent = "加载失败";
  }
}

document.getElementById("employee-filter").addEventListener("submit", (event) => { event.preventDefault(); loadEmployees(); });
document.getElementById("employee-filter").addEventListener("reset", () => window.setTimeout(loadEmployees, 0));
document.getElementById("page-previous").addEventListener("click", () => { currentPage -= 1; renderEmployees(); });
document.getElementById("page-next").addEventListener("click", () => { currentPage += 1; renderEmployees(); });
loadEmployees();
