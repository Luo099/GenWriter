import { useState } from 'react';
import { Globe, Folder, PieChart, Check, AlertCircle } from 'lucide-react';
import PageHeading from './PageHeading';
import * as writingSkillsApi from '../api/writingSkills';

const WritingSkillLearningPanel = ({ projectId, onBack }) => {
  const [articleContent, setArticleContent] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('GLOBAL');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    if (!articleContent.trim()) {
      setError('请输入文章内容');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await writingSkillsApi.learnFromArticle({
        articleContent: articleContent.trim(),
        description: description.trim() || undefined,
        scope,
        projectId: scope === 'PROJECT' ? projectId : undefined,
      });
      setResult(res);
      if (res.success && res.storedCount > 0) {
        setArticleContent('');
        setDescription('');
      }
    } catch (e) {
      setError(e.message || '学习请求失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="memory-panel learning-page">
      <PageHeading title="风格学习" onBack={onBack} />
      <div className="learning-panel-body">
        {error && (
          <div className="learning-error" onClick={() => setError(null)}>
            {error}
          </div>
        )}

        <div className="learning-form">
          <div className="learning-form-group">
            <label htmlFor="learning-article">
              示例文章
              <span className="required">*</span>
            </label>
            <textarea
              id="learning-article" className="learning-textarea"
              rows={12}
              placeholder="粘贴示例文章…"
              value={articleContent}
              onChange={(e) => setArticleContent(e.target.value)}
            />
            <div className="learning-hint">
              {articleContent.length} 字
            </div>
          </div>

          <div className="learning-form-group">
            <label htmlFor="learning-description">学习重点 <span className="field-optional">可选</span></label>
            <input
              id="learning-description" className="learning-input"
              type="text"
              placeholder="叙事节奏、对话或语言风格"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="learning-form-group">
            <label>适用范围</label>
            <div className="learning-scope-options">
              <button
                aria-pressed={scope === 'GLOBAL'} className={`learning-scope-btn ${scope === 'GLOBAL' ? 'active' : ''}`}
                onClick={() => setScope('GLOBAL')}
              >
                <Globe size={16} strokeWidth={2} />
                全局可用
              </button>
              <button
                aria-pressed={scope === 'PROJECT'} className={`learning-scope-btn ${scope === 'PROJECT' ? 'active' : ''}`}
                onClick={() => setScope('PROJECT')}
                disabled={!projectId}
              >
                <Folder size={16} strokeWidth={2} />
                仅限当前项目
                {!projectId && <span className="learning-scope-hint">（需先选择项目）</span>}
              </button>
            </div>
          </div>

          <button
            className="learning-submit-btn"
            onClick={handleSubmit}
            disabled={loading || !articleContent.trim()}
          >
            {loading ? (
              <>
                <span className="learning-spinner"></span>
                正在分析文章...
              </>
            ) : (
              <>
                <PieChart size={18} strokeWidth={2} />
                开始学习
              </>
            )}
          </button>
        </div>

        {result && (
          <div className={`learning-result ${result.success ? 'success' : 'fail'}`}>
            <div className="learning-result-header">
              <div className="learning-result-icon">
                {result.success ? (
                  <Check size={20} strokeWidth={2.5} />
                ) : (
                  <AlertCircle size={20} strokeWidth={2.5} />
                )}
              </div>
              <div className="learning-result-title">{result.message}</div>
            </div>
            {result.success && result.skills?.length > 0 && (
              <div className="learning-result-skills">
                <div className="learning-result-subtitle">已保存的技巧</div>
                <div className="learning-skill-list">
                  {result.skills.map((skill, idx) => (
                    <div className="learning-skill-item" key={idx}>
                      <span className="learning-skill-name">{skill.skillName}</span>
                      {skill.category && (
                        <span className="learning-skill-category">{skill.category}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WritingSkillLearningPanel;
