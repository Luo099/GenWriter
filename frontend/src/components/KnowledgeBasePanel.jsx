import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfirm } from './ui/ConfirmDialog';
import * as knowledgeBasesApi from '../api/knowledgeBases';
import KnowledgeBaseDetail from './KnowledgeBaseDetail';
import '../styles/global.css';
import { ChevronLeft, Plus, Search, FileText, Pencil, Trash2, X } from 'lucide-react';

const KB_TYPE_MAP = {
  reference: '参考资料',
  template: '模板',
  style: '风格指南',
};

const KnowledgeBasePanel = ({ onBack }) => {
  const confirm = useConfirm();
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [loading, setLoading] = useState(false);
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
    if (!await confirm(`确定要删除知识库"${kb.name}"吗？`)) return;
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
    <div className="memory-panel">
      <div className="memory-panel-header">
        <div className="memory-panel-header-left">
          {onBack && (
            <button className="memory-back-btn" onClick={onBack} title="返回">
              <ChevronLeft size={18} strokeWidth={2} />
            </button>
          )}
          <h2 className="memory-panel-title">知识库</h2>
          <span className="memory-panel-count">共 {knowledgeBases.length} 个</span>
        </div>
        <button className="memory-new-btn" onClick={handleOpenCreate}>
          <Plus size={16} strokeWidth={2} />
          新建知识库
        </button>
      </div>

      <div className="memory-toolbar">
        <div className="memory-search">
          <Search size={16} strokeWidth={2} className="search-icon" />
          <input
            type="text"
            placeholder="搜索知识库名称..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="memory-search-input"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="memory-filter-select"
        >
          <option value="">全部类型</option>
          {Object.entries(KB_TYPE_MAP).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
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
        <div className="memory-empty">
          <p>暂无知识库</p>
          <span>创建知识库后，您可以上传文档进行RAG检索</span>
        </div>
      ) : (
        <>
          <div
            className="memory-table-header"
            style={{ gridTemplateColumns: '1fr 100px 140px 100px', paddingLeft: 'var(--panel-padding-x)' }}
          >
            <span>名称 / 描述</span>
            <span>类型</span>
            <span>更新时间</span>
            <span>操作</span>
          </div>
          <div className="memory-list">
            {knowledgeBases.map((kb) => (
              <div
                key={kb.id}
                className="memory-card"
                style={{ gridTemplateColumns: '1fr 100px 140px 100px', paddingLeft: 'var(--panel-padding-x)', paddingRight: 'var(--panel-padding-x)' }}
              >
                <div className="memory-card-content">
                  <div style={{ fontWeight: 500, marginBottom: 2 }}>{kb.name}</div>
                  {kb.description && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{kb.description}</div>
                  )}
                </div>
                <div className="memory-card-type">
                  <span className="memory-badge" style={{ background: '#f0f9ff', color: '#0ea5e9' }}>
                    {KB_TYPE_MAP[kb.type] || kb.type}
                  </span>
                </div>
                <div className="memory-card-updated">
                  {kb.updatedAt ? new Date(kb.updatedAt).toLocaleString() : '-'}
                </div>
                <div className="memory-card-actions">
                  <button
                    className="memory-action-btn"
                    onClick={() => setDetailKbId(kb.id)}
                    title="进入详情"
                  >
                    <FileText size={14} strokeWidth={2} />
                  </button>
                  <button
                    className="memory-action-btn"
                    onClick={() => handleOpenEdit(kb)}
                    title="编辑"
                  >
                    <Pencil size={14} strokeWidth={2} />
                  </button>
                  <button
                    className="memory-action-btn memory-action-delete"
                    onClick={() => handleDelete(kb)}
                    title="删除"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showModal && (
        <div className="memory-modal-overlay" onClick={handleCloseModal}>
          <div className="memory-modal" onClick={(e) => e.stopPropagation()}>
            <div className="memory-modal-header">
              <h3>{editingKB ? '编辑知识库' : '新建知识库'}</h3>
              <button className="memory-modal-close" onClick={handleCloseModal}>
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className="memory-modal-body">
              {formError && <div className="memory-form-error">{formError}</div>}
              <div className="memory-form-group">
                <label>名称 <span className="required">*</span></label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="输入知识库名称..."
                />
              </div>
              <div className="memory-form-group">
                <label>描述</label>
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="输入知识库描述..."
                />
              </div>
              <div className="memory-form-group">
                <label>类型</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  {Object.entries(KB_TYPE_MAP).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
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
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBasePanel;
