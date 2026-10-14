// 使用相对路径：浏览器请求先到 Nginx 的 7081，再由 Nginx 转发给 Flask 的 5000。
const API_BASE_URL = "";

const registerForm = document.getElementById("register-form");
const message = document.getElementById("message");
const employeeList = document.getElementById("employee-list");
const emptyTip = document.getElementById("empty-tip");
const refreshButton = document.getElementById("refresh-button");

function showMessage(text, type) {
  message.textContent = text;
  message.className = `message ${type}`;
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "-";
  return cell;
}

function renderEmployees(employees) {
  employeeList.innerHTML = "";
  emptyTip.hidden = employees.length > 0;

  for (const employee of employees) {
    const row = document.createElement("tr");
    row.append(
      createCell(employee.id), createCell(employee.name),
      createCell(employee.employee_no), createCell(employee.phone),
      createCell(employee.email), createCell(employee.department),
      createCell(employee.position), createCell(employee.role)
    );
    employeeList.append(row);
  }
}

async function loadEmployees() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/employees`);
    const result = await response.json();
    renderEmployees(result.employees);
  } catch (error) {
    showMessage("无法连接后端，请确认 Flask 服务已启动。", "error");
  }
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirm-password").value;
  if (password !== confirmPassword) {
    showMessage("两次输入的密码不一致。", "error");
    return;
  }

  const data = {
    name: document.getElementById("name").value.trim(),
    employee_no: document.getElementById("employee-no").value.trim(),
    password, confirm_password: confirmPassword,
    phone: document.getElementById("phone").value.trim(),
    email: document.getElementById("email").value.trim(),
    department: document.getElementById("department").value.trim(),
    position: document.getElementById("position").value.trim()
  };

  try {
    const response = await fetch(`${API_BASE_URL}/api/employees/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) {
      showMessage(result.message || "注册失败。", "error");
      return;
    }
    showMessage(result.message, "success");
    registerForm.reset();
    loadEmployees();
  } catch (error) {
    showMessage("无法连接后端，请确认 Flask 服务已启动。", "error");
  }
});

refreshButton.addEventListener("click", loadEmployees);
loadEmployees();
