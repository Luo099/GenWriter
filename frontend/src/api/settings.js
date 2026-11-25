import client from './client';

export const getWritingOutputSettings = () => client.get('/settings/writing-output');

export const updateWritingOutputSettings = (payloadOrMarkdown) => {
  const payload = typeof payloadOrMarkdown === 'boolean'
    ? { markdownEnabled: payloadOrMarkdown }
    : payloadOrMarkdown;
  return client.put('/settings/writing-output', payload);
};
