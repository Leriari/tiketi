// Which organisation the Organiser Console is showing. A user can belong
// to several (owner here, staff there); every organiser call in
// live/liveApi.js is scoped to this one. Set by AuthContext once the
// user's memberships load, and by the console's organisation switcher.

const KEY = "tiketi_active_org";

export function getActiveOrgId() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setActiveOrgId(id) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable — the console falls back to the first organisation.
  }
}
