import { useState, useEffect } from 'react';
import { Layers, MessageSquare, BookOpen, PenLine } from 'lucide-react';
import '../styles/global.css';

const greetings = [
  '你好，我是 GenWriter',
  '嗨，开始今天的写作',
  '你好，我是 GenWriter',
  '准备好了，随时开始',
];

const subtitles = [
  '写作助手，帮你从想法到成稿。',
  '从想法到成稿，一步到位。',
  '写作助手，帮你从想法到成稿。',
  '从想法到成稿，一步到位。',
];

const guides = [
  { icon: MessageSquare, label: '开始对话', hint: '描述你的写作需求' },
  { icon: BookOpen, label: '导入知识', hint: '上传参考资料辅助写作' },
  { icon: PenLine, label: '写作工作台', hint: '在编辑器中精修文稿' },
];

const WelcomeScreen = ({ onSuggestionClick }) => {
  const [greeting, setGreeting] = useState('');
  const [subtitle, setSubtitle] = useState('');

  useEffect(() => {
    const index = Math.floor(Math.random() * greetings.length);
    setGreeting(greetings[index]);
    setSubtitle(subtitles[index]);
  }, []);

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <div className="welcome-logo">
          <Layers size={48} strokeWidth={1.5} color="var(--accent-color)" />
        </div>
        <h2 className="welcome-title">{greeting}</h2>
        <p className="welcome-subtitle">{subtitle}</p>
        <div className="welcome-guides">
          {guides.map((g) => (
            <button
              key={g.label}
              className="welcome-guide-card"
              onClick={() => onSuggestionClick?.(g.label)}
            >
              <g.icon size={22} strokeWidth={1.8} />
              <strong>{g.label}</strong>
              <span>{g.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
