// Client for the backend's internal routes (access requests). The browser is
// authenticated by its session cookie, so no token is needed.
const BASE_URL = import.meta.env.VITE_HOST_URL || '/api/internal';

const api = async (path, opts = {}) => {
  try {
    const res = await fetch([BASE_URL, path].join(''), {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const json = await res.json();

    if (!res.ok) {
      throw new Error(json.message);
    }

    return json;
  } catch (error) {
    return Promise.reject(error);
  }
};

export default api;
