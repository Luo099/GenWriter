import { useState, useEffect, useCallback, useRef } from 'react';
import * as knowledgeBasesApi from '../api/knowledgeBases';
import KnowledgeBaseDetail from './KnowledgeBaseDetail';
import SelectField from './SelectField';
import PageHeading from './PageHeading';
import DialogSurface from './DialogSurface';
import EmptyState from './EmptyState';
import { Library, ArrowUpRight, Pencil, Trash2 } from 'lucide-react';

const KB_TYPE_MAP = {
  reference: '参考资料',
  template: '模板',
  style: '风格指南',
};

const KnowledgeBasePanel = ({ onBack }) => {
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [keyword, setKeyword] = useState('');
  const [filterType, setFilterType] = useState('');
  const searchDebounceRef = useRef(null);

  const [showModal, setShowModal] = useState(false);
  const [editingKB, setEditingKB] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'reference',
  });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [detailKbId, setDetailKbId] = useState(null);

  const fetchKnowledgeBases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result;
      if (keyword.trim()) {
        result = await knowledgeBasesApi.searchKnowledgeBases(keyword.trim());
      } else {
        result = await knowledgeBasesApi.getAllKnowledgeBases();
      }
      let list = Array.isArray(result) ? result : result?.items || [];
      if (filterType) {
        list = list.filter((kb) => kb.type === filterType);
      }
      setKnowledgeBases(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [keyword, filterType]);

  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      fetchKnowledgeBases();
    }, 300);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [fetchKnowledgeBases]);

  const handleOpenCreate = () => {
    setEditingKB(null);
    setFormData({ name: '', description: '', type: 'reference' });
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (kb) => {
    setEditingKB(kb);
    setFormData({
      name: kb.name || '',
      description: kb.description || '',
      type: kb.type || 'reference',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingKB(null);
    setFormError(null);
  };

  const validateForm = () => {
    if (!formData.name || !formData.name.trim()) {
      return '知识库名称不能为空';
    }
    return null;
  };

  const handleSave = async () => {
    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        type: formData.type,
      };
      if (editingKB) {
        await knowledgeBasesApi.updateKnowledgeBase(editingKB.id, payload);
      } else {
        await knowledgeBasesApi.createKnowledgeBase(payload);
      }
      setShowModal(false);
      fetchKnowledgeBases();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (kb) => {
    if (!window.confirm(`确定要删除知识库"${kb.name}"吗？`)) return;
    try {
      await knowledgeBasesApi.deleteKnowledgeBase(kb.id);
      fetchKnowledgeBases();
    } catch (e) {
      setError(e.message);
    }
  };

  if (detailKbId) {
    return (
      <KnowledgeBaseDetail
        kbId={detailKbId}
        onBack={() => setDetailKbId(null)}
      />
    );
  }

  return (
    <div className="memory-panel knowledge-panel">
      <PageHeading title="知识库" count={`${knowledgeBases.length} 个`} onBack={onBack}
        actions={<button className="memory-new-btn" onClick={handleOpenCreate}><span aria-hidden="true">＋</span> 新建知识库</button>} />

      <div className="memory-toolbar">
        <div className="memory-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="search-icon">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            placeholder="搜索知识库名称..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="memory-search-input"
          />
        </div>
        <SelectField aria-label="知识库类型" value={filterType} onChange={setFilterType} className="memory-filter-select"
          options={[{ value: '', label: '全部类型' }, ...Object.entries(KB_TYPE_MAP).map(([value, label]) => ({ value, label }))]} />
      </div>

      {error && (
        <div className="memory-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {loading && knowledgeBases.length === 0 ? (
        <div className="memory-loading">
          <div className="loading-spinner"></div>
          <p>加载中...</p>
        </div>
      ) : knowledgeBases.length === 0 ? (
        <EmptyState filtered={Boolean(keyword || filterType)} title={keyword || filterType ? '无匹配知识库' : '暂无知识库'} action={keyword || filterType ? '清除筛选' : '新建知识库'} onAction={keyword || filterType ? () => { setKeyword(''); setFilterType(''); } : handleOpenCreate} />
      ) : (
        <div className="knowledge-grid">
          {knowledgeBases.map((kb) => <article className={`knowledge-card knowledge-${kb.type}`} key={kb.id}>
            <div className="knowledge-card-top"><div className="knowledge-book"><Library size={23} strokeWidth={1.4} /></div><span className="knowledge-type">{KB_TYPE_MAP[kb.type] || kb.type}</span></div>
            <button type="button" className="knowledge-card-title" onClick={() => setDetailKbId(kb.id)}>{kb.name}<ArrowUpRight size={18} /></button>
            <p>{kb.description || ''}</p>
            <div className="knowledge-card-footer"><span>{Number(kb.chunkCount || 0).toLocaleString('zh-CN')} 个知识片段</span><div>
              <button className="memory-action-btn" onClick={() => handleOpenEdit(kb)} title={`编辑 ${kb.name}`} aria-label={`编辑 ${kb.name}`}><Pencil size={15} /></button>
              <button className="memory-action-btn memory-action-delete" onClick={() => handleDelete(kb)} title={`删除 ${kb.name}`} aria-label={`删除 ${kb.name}`}><Trash2 size={15} /></button>
            </div></div>
            <span className="knowledge-card-date">{kb.updatedAt ? `更新于 ${new Date(kb.updatedAt).toLocaleDateString('zh-CN')}` : '尚未更新'}</span>
          </article>)}
        </div>
      )}

      {showModal && (
        <div className="memory-modal-overlay" onClick={handleCloseModal}>
          <DialogSurface className="memory-modal" label={editingKB ? '编辑知识库' : '新建知识库'} onClose={handleCloseModal} busy={saving}>
            <div className="memory-modal-header">
              <h1 className="dialog-title">{editingKB ? '编辑知识库' : '新建知识库'}</h1>
              <button className="memory-modal-close" aria-label="关闭对话框" onClick={handleCloseModal}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="memory-modal-body">
              {formError && <div className="memory-form-error">{formError}</div>}
              <div className="memory-form-group">
                <label htmlFor="knowledge-name">名称 <span className="required">*</span></label>
                <input
                  type="text"
                  id="knowledge-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="输入知识库名称..."
                />
              </div>
              <div className="memory-form-group">
                <label htmlFor="knowledge-description">描述</label>
                <textarea
                  id="knowledge-description"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="输入知识库描述..."
                />
              </div>
              <div className="memory-form-group">
                <label htmlFor="knowledge-type">类型</label>
                <SelectField id="knowledge-type" aria-label="知识库类型" value={formData.type} onChange={(value) => setFormData({ ...formData, type: value })}
                  options={Object.entries(KB_TYPE_MAP).map(([value, label]) => ({ value, label }))} />
              </div>
            </div>
            <div className="memory-modal-footer">
              <button className="memory-btn-secondary" onClick={handleCloseModal}>
                取消
              </button>
              <button className="memory-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </DialogSurface>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBasePanel;
