const API_BASE = "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API error: ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export const api = {
  getUnreadItems: (params) => request(`/items/unread${params}`),
  getUnreadTabs: () => request("/items/unread/tabs"),
  saveItem: (id, tags) => request(`/items/${id}/save`, { method: "POST", body: JSON.stringify({ tags }) }),
  ignoreItem: (id) => request(`/items/${id}/ignore`, { method: "POST" }),
  getSavedItems: (params) => request(`/items/saved${params}`),
  updateItemTags: (id, tags) => request(`/items/${id}/tags`, { method: "PUT", body: JSON.stringify({ tags }) }),
  unsaveItem: (id) => request(`/items/${id}/unsave`, { method: "POST" }),
  listTags: () => request("/tags"),
  listSources: () => request("/sources"),
  createSource: (payload) => request("/sources", { method: "POST", body: JSON.stringify(payload) }),
  updateSource: (id, payload) => request(`/sources/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteSource: (id) => request(`/sources/${id}`, { method: "DELETE" }),
  listAuthorRules: () => request("/author-rules"),
  createAuthorRule: (payload) => request("/author-rules", { method: "POST", body: JSON.stringify(payload) }),
  updateAuthorRule: (id, payload) => request(`/author-rules/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteAuthorRule: (id) => request(`/author-rules/${id}`, { method: "DELETE" }),
  listKeywordRules: () => request("/keyword-rules"),
  createKeywordRule: (payload) => request("/keyword-rules", { method: "POST", body: JSON.stringify(payload) }),
  updateKeywordRule: (id, payload) => request(`/keyword-rules/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteKeywordRule: (id) => request(`/keyword-rules/${id}`, { method: "DELETE" })
};

export function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) {
      query.append(key, value);
    }
  });
  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}