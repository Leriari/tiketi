// Token storage — shared by mock and live API implementations, independent
// of which backend is actually serving requests right now.

const TOKEN_KEY = "tiketi_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
