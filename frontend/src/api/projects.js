import client from './client';

export const getAllProjects = () => client.get('/projects');

export const getProject = (id) => client.get(`/projects/${id}`);

export const createProject = (data) => client.post('/projects', data);

export const updateProject = (id, data) => client.put(`/projects/${id}`, data);

export const deleteProject = (id) => client.delete(`/projects/${id}`);

export const getProjectKnowledgeBases = (projectId) =>
  client.get(`/projects/${projectId}/knowledge-bases`);

export const replaceProjectKnowledgeBases = (projectId, knowledgeBaseIds) =>
  client.put(`/projects/${projectId}/knowledge-bases`, { knowledgeBaseIds });
