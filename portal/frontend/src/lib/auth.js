const KEY = 'veyn_portal_token';
export const getToken = () => typeof window !== 'undefined' ? localStorage.getItem(KEY) : null;
export const setToken = (t) => localStorage.setItem(KEY, t);
export const clearToken = () => localStorage.removeItem(KEY);
