import client from './client';

export const getDashboard = (limit = 50) =>
  client.get('/observability', { params: { limit } });

export const getRunDetail = (runId) =>
  client.get(`/observability/runs/${runId}`);

export const getSessionEvents = (sessionId, limit = 200) =>
  client.get(`/observability/sessions/${sessionId}/events`, { params: { limit } });
