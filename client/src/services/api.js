const API_URL = "https://mern-chat-khk0.onrender.com";

export function getApiUrl() {
  return API_URL;
}

export async function api(path, options = {}) {
  const token = localStorage.getItem("chat_token");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || "Request failed");
  }

  return data;
}
