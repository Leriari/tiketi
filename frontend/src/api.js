// Single entry point every page imports. Which backend actually answers is
// controlled by VITE_USE_MOCK (frontend/.env) — default true today, so the
// whole UI works without the FastAPI server running. Flip it to "false" once
// a page is ready to bind for real; both implementations expose the exact
// same function names for that reason (see live/liveApi.js and
// mock/mockApi.js — keep them in sync as pages gain new calls).
import { mockApi } from "./mock/mockApi";
import { liveApi } from "./live/liveApi";

const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? "true") !== "false";

export const api = USE_MOCK ? mockApi : liveApi;
export const usingMockBackend = USE_MOCK;

export { ApiError } from "./errors";
export { getToken, setToken, clearToken } from "./auth-storage";
