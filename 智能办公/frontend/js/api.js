const API_BASE_URL = "";

async function getCsrfToken() {
  const stored = sessionStorage.getItem("csrf_token");
  if (stored) return stored;
  const response = await fetch(`${API_BASE_URL}/api/auth/csrf`);
  if (!response.ok) return "";
  const result = await response.json();
  if (result.csrf_token) sessionStorage.setItem("csrf_token", result.csrf_token);
  return result.csrf_token || "";
}

async function requestApi(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && path !== "/api/auth/login") {
    const token = await getCsrfToken();
    options.headers = { ...(options.headers || {}), "X-CSRF-Token": token };
  }
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    if (result) throw new Error(result.message || "请求失败。");
    throw new Error(`后端服务不可用（HTTP ${response.status}），请确认 Flask 已启动在 5000 端口。`);
  }
  if (!result) throw new Error("接口返回格式错误，请检查 Nginx 到 Flask 的反向代理配置。");
  return result;
}
