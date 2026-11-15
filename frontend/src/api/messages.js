import client from './client';

export const getMessagesBySessionId = (sessionId) =>
  client.get(`/messages/session/${sessionId}`);

export const createMessage = (data) => client.post('/messages', data);

export const chat = (sessionId, userInput, type = 'AUTO', webSearch = true, attachmentIds = [], documentId = '', target) => {
  const params = new URLSearchParams({ type, webSearch });
  return client.post(`/messages/${sessionId}/chat?${params}`, {
    text: userInput,
    attachmentIds,
    documentId: documentId || undefined,
    target,
  });
};

export const updateMessage = (id, data) => client.put(`/messages/${id}`, data);

export const deleteMessagesBySessionId = (sessionId) =>
  client.delete(`/messages/session/${sessionId}`);
