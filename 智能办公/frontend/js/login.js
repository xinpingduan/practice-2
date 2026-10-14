(() => {
  const activeScript = document.currentScript;
  if (!activeScript || document.querySelector('script[data-interface-motion]')) return;
  const motionScript = document.createElement("script");
  motionScript.src = new URL("motion.js?v=4", activeScript.src).href;
  motionScript.dataset.interfaceMotion = "true";
  motionScript.addEventListener("load", () => { document.documentElement.dataset.motionAsset = "loaded"; });
  motionScript.addEventListener("error", () => { document.documentElement.dataset.motionAsset = "error"; });
  document.head.append(motionScript);
})();

const form = document.getElementById("login-form");
const message = document.getElementById("message");
const passwordInput = document.getElementById("password");
const passwordToggle = document.getElementById("toggle-password");
const submitButton = document.getElementById("login-submit");
const submitLabel = submitButton.querySelector(".login-button-label");

passwordToggle.addEventListener("click", () => {
  const shouldShow = passwordInput.type === "password";
  passwordInput.type = shouldShow ? "text" : "password";
  passwordToggle.textContent = shouldShow ? "隐藏" : "显示";
  passwordToggle.setAttribute("aria-label", shouldShow ? "隐藏密码" : "显示密码");
  passwordToggle.setAttribute("aria-pressed", String(shouldShow));
  passwordInput.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitButton.disabled) return;
  message.textContent = "";
  message.className = "message";
  submitButton.disabled = true;
  passwordToggle.disabled = true;
  submitLabel.textContent = "正在登录…";
  form.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_no: document.getElementById("employee-no").value.trim(), password: document.getElementById("password").value })
    });
    const contentType = response.headers.get("content-type") || "";
    const result = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
      if (result) throw new Error(result.message || "登录失败");
      throw new Error(`后端服务不可用（HTTP ${response.status}），请先启动 Flask 后端。`);
    }
    if (!result) throw new Error("接口返回格式错误，请检查 Nginx 代理配置。");
    if (result.csrf_token) sessionStorage.setItem("csrf_token", result.csrf_token);
    submitLabel.textContent = "登录成功";
    const destination = result.user.role === "super_admin" ? "index.html" : "pages/profile.html";
    if (window.navigateWithMotion) window.navigateWithMotion(destination);
    else window.location.href = destination;
  } catch (error) {
    message.textContent = error.message;
    message.className = "message error";
    submitButton.disabled = false;
    passwordToggle.disabled = false;
    submitLabel.textContent = "登录";
    form.removeAttribute("aria-busy");
  }
});
