import { api } from './client';

export const getMe = () => api.get('/me');

export const getOrgTree = (date) => api.get('/org/tree', { date });
export const getOrgNode = (id, date) => api.get(`/org/nodes/${id}`, { date });
export const createOrgNode = (data) => api.post('/org/nodes', data);
export const updateOrgNode = (id, data) => api.patch(`/org/nodes/${id}`, data);

export const searchUsers = (query) => api.get('/users', query);

export const createMembership = (data) => api.post('/memberships', data);
export const updateMembership = (id, data) => api.patch(`/memberships/${id}`, data);
