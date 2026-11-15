import { useState, useEffect } from 'react';
import '../styles/global.css';

const greetings = [
  '你好，我是 GenWriter',
  '嗨，我是你的 AI 写作助手',
  '今天想写点什么？',
  '把想法交给我，剩下的交给流程',
];

const subtitles = [
  '从一句话到大纲、初稿、评审，把它做成可回溯的文稿。',
  '选题、调研、起草、润色，每一步都留痕迹。',
  '告诉我主题，我先给你一版结构，再一起改。',
  '文稿会存成版本，随时可以回到任意一版。',
];

const QUICK_STARTS = [
  {
    key: 'create',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    ),
    title: '从零起草',
    desc: '给一个主题，生成大纲与初稿',
    prompt: '帮我写一篇关于「」的文章，先给出结构大纲。',
  },
  {
    key: 'continue',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </svg>
    ),
    title: '接着写下去',
    desc: '沿着已有段落与语气续写',
    prompt: '接着下面的内容继续写，保持同样的语气：\n',
  },
  {
    key: 'polish',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" />
        <path d="M18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9z" />
      </svg>
    ),
    title: '润色一段',
    desc: '改写表达、压缩冗余，保持原意',
    prompt: '帮我润色这段话，让表达更准确简洁：\n',
  },
  {
    key: 'qa',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
    ),
    title: '查资料再写',
    desc: '联网检索后给出带出处的回答',
    prompt: '帮我检索并整理「」的最新资料，给出要点和出处。',
  },
];

const WelcomeScreen = ({ onSuggestionClick }) => {
  const [greeting, setGreeting] = useState('');
  const [subtitle, setSubtitle] = useState('');

  useEffect(() => {
    const index = Math.floor(Math.random() * greetings.length);
    setGreeting(greetings[index]);
    setSubtitle(subtitles[index % subtitles.length]);
  }, []);

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <div className="welcome-logo" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
            <path d="M12 2.5 21 7l-9 4.5L3 7l9-4.5z"></path>
            <path d="M3 12l9 4.5L21 12"></path>
            <path d="M3 17l9 4.5L21 17"></path>
          </svg>
        </div>
        <h1 className="welcome-title">{greeting}</h1>
        <p className="welcome-subtitle">{subtitle}</p>

        <div className="suggestions-grid">
          {QUICK_STARTS.map((item) => (
            <button
              key={item.key}
              type="button"
              className="suggestion-card"
              onClick={() => onSuggestionClick?.(item.prompt)}
            >
              <span className="suggestion-icon">{item.icon}</span>
              <span className="suggestion-text">{item.title}</span>
              <span className="suggestion-desc">{item.desc}</span>
            </button>
          ))}
        </div>

        <div className="welcome-capabilities">
          <span>知识库检索</span>
          <span>长期记忆</span>
          <span>版本化文稿</span>
          <span>多模型切换</span>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
