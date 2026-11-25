import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Pencil, Trash2, X } from 'lucide-react';
import { useConfirm } from './ui/ConfirmDialog';
import * as memoriesApi from '../api/memories';
import SelectField from './SelectField';
import PageHeading from './PageHeading';
import DialogSurface from './DialogSurface';
import EmptyState from './EmptyState';

const MEMORY_TYPE_MAP = {
  WRITING_PREFERENCE: '写作偏好',
  CORRECTION_PATTERN: '纠错模式',
  DOMAIN_KNOWLEDGE: '领域知识',
  WORLD_SETTING: '世界观设定',
  CHARACTER_PROFILE: '人物设定',
  FORESHADOWING: '伏笔',
  WRITING_TECHNIQUE: '写作技巧',
};

const SCOPE_MAP = {
  GLOBAL: '全局',
  PROJECT: '项目',
};

const IMPORTANCE_CLASS = {
  HIGH: 'importance-high',
  MEDIUM: 'importance-medium',
  LOW: 'importance-low',
};

const IMPORTANCE_LABEL = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};

function MemoryPreview({ content = '' }) {
  const structured = /^\s*## Name\s*\r?\n([^\n]+)\r?\n+\s*## Details\s*\r?\n([\s\S]*)/u.exec(content);
  return <div className="memory-card-content" title={content}>{structured ? <><strong>{structured[1]}</strong><p>{structured[2]}</p></> : content}</div>;
}

const MemoryPanel = ({ projectId, onBack }) => {
  const confirm = useConfirm();
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(20);

  const [keyword, setKeyword] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterScope, setFilterScope] = useState('');
  const [filterImportance, setFilterImportance] = useState('');
  const searchDebounceRef = useRef(null);

  const [showModal, setShowModal] = useState(false);
  const [editingMemory, setEditingMemory] = useState(null);
  const [formData, setFormData] = useState({
    content: '',
    memoryType: 'WRITING_PREFERENCE',
    scope: 'GLOBAL',
    projectId: projectId || '',
    importance: 'MEDIUM',
  });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deletingId, setDeletingId] = useState(null);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page,
        size,
        ...(filterType ? { type: filterType } : {}),
        ...(filterScope ? { scope: filterScope } : {}),
        ...(filterImportance ? { importance: filterImportance } : {}),
        ...(keyword ? { keyword } : {}),
        ...(projectId ? { projectId } : {}),
      };
      const result = await memoriesApi.getMemories(params);
      setMemories(result.items || []);
      setTotal(result.total || 0);
      setSelectedIds(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, size, filterType, filterScope, filterImportance, keyword, projectId]);

  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      setPage(1);
    }, 300);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [keyword, filterType, filterScope, filterImportance, projectId]);

  useEffect(() => {
    Promise.resolve().then(fetchMemories);
  }, [page, fetchMemories]);

  const handleOpenCreate = () => {
    setEditingMemory(null);
    setFormData({
      content: '',
      memoryType: 'WRITING_PREFERENCE',
      scope: projectId ? 'PROJECT' : 'GLOBAL',
      projectId: projectId || '',
      importance: 'MEDIUM',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (memory) => {
    setEditingMemory(memory);
    setFormData({
      content: memory.content || '',
      memoryType: memory.memoryType || 'WRITING_PREFERENCE',
      scope: memory.scope || 'GLOBAL',
      projectId: memory.projectId || projectId || '',
      importance: memory.importance || 'MEDIUM',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingMemory(null);
    setFormError(null);
  };

  const validateForm = () => {
    if (!formData.content || !formData.content.trim()) {
      return '记忆内容不能为空';
    }
    if (formData.scope === 'PROJECT' && !formData.projectId) {
      return '项目级记忆需要指定项目';
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
        content: formData.content.trim(),
        memoryType: formData.memoryType,
        scope: formData.scope,
        ...(formData.projectId ? { projectId: formData.projectId } : {}),
        importance: formData.importance,
      };
      if (editingMemory) {
        await memoriesApi.updateMemory(editingMemory.id, payload);
      } else {
        await memoriesApi.createMemory(payload);
      }
      setShowModal(false);
      fetchMemories();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!await confirm('确定要删除这条记忆吗？')) return;
    setDeletingId(id);
    try {
      await memoriesApi.deleteMemory(id);
      fetchMemories();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!await confirm(`确定要删除选中的 ${selectedIds.size} 条记忆吗？`)) return;
    try {
      await memoriesApi.batchDeleteMemories(Array.from(selectedIds));
      fetchMemories();
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === memories.length && memories.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(memories.map((m) => m.id)));
    }
  };

  const totalPages = Math.ceil(total / size) || 1;

  return (
    <div className="memory-panel">
      <PageHeading title="长期记忆" count={`${total} 条`} onBack={onBack}
        actions={<button className="memory-new-btn" onClick={handleOpenCreate}><span aria-hidden="true">＋</span> 新建记忆</button>} />

      <div className="memory-toolbar">
        <div className="memory-search">
          <Search size={16} strokeWidth={2} className="search-icon" />
          <input
            type="text"
            placeholder="搜索记忆内容..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="memory-search-input"
          />
        </div>
        <SelectField aria-label="记忆类型" value={filterType} onChange={setFilterType} className="memory-filter-select" options={[{ value: '', label: '全部类型' }, ...Object.entries(MEMORY_TYPE_MAP).map(([value, label]) => ({ value, label }))]} />
        <SelectField aria-label="记忆作用域" value={filterScope} onChange={setFilterScope} className="memory-filter-select" options={[{ value: '', label: '全部作用域' }, ...Object.entries(SCOPE_MAP).map(([value, label]) => ({ value, label }))]} />
        <SelectField aria-label="记忆重要性" value={filterImportance} onChange={setFilterImportance} className="memory-filter-select" options={[{ value: '', label: '全部重要性' }, { value: 'HIGH', label: '高' }, { value: 'MEDIUM', label: '中' }, { value: 'LOW', label: '低' }]} />
        {selectedIds.size > 0 && (
          <button className="memory-batch-delete-btn" onClick={handleBatchDelete}>
            删除选中 ({selectedIds.size})
          </button>
        )}
      </div>

      {error && (
        <div className="memory-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {loading && memories.length === 0 ? (
        <div className="memory-loading">
          <div className="loading-spinner"></div>
          <p>加载中...</p>
        </div>
      ) : memories.length === 0 ? (
        <EmptyState filtered={Boolean(keyword || filterType || filterScope || filterImportance)} title={keyword || filterType || filterScope || filterImportance ? '无匹配记忆' : '暂无记忆'} action={keyword || filterType || filterScope || filterImportance ? '清除筛选' : '新建记忆'} onAction={keyword || filterType || filterScope || filterImportance ? () => { setKeyword(''); setFilterType(''); setFilterScope(''); setFilterImportance(''); } : handleOpenCreate} />
      ) : (
        <>
          <div className="memory-table-header">
            <label className="memory-checkbox-wrap">
              <input
                type="checkbox"
                checked={memories.length > 0 && selectedIds.size === memories.length}
                onChange={toggleSelectAll}
              />
            </label>
            <span className="memory-col-content">内容</span>
            <span className="memory-col-type">类型</span>
            <span className="memory-col-scope">作用域</span>
            <span className="memory-col-importance">重要性</span>
            <span className="memory-col-updated">更新时间</span>
            <span className="memory-col-actions">操作</span>
          </div>
          <div className="memory-list">
            {memories.map((m) => (
              <div key={m.id} className={`memory-card ${selectedIds.has(m.id) ? 'selected' : ''}`}>
                <label className="memory-checkbox-wrap">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(m.id)}
                    onChange={() => toggleSelect(m.id)}
                  />
                </label>
                <MemoryPreview content={m.content} />
                <div className="memory-card-type">
                  <span className={`memory-badge memory-badge-type-${m.memoryType}`}>
                    {MEMORY_TYPE_MAP[m.memoryType] || m.memoryType}
                  </span>
                </div>
                <div className="memory-card-scope">
                  {SCOPE_MAP[m.scope] || m.scope}
                </div>
                <div className="memory-card-importance">
                  <span
                    className={`memory-importance-dot ${IMPORTANCE_CLASS[m.importance] || 'importance-none'}`}
                  />
                  {IMPORTANCE_LABEL[m.importance] || m.importance}
                </div>
                <div className="memory-card-updated">
                  {m.updatedAt ? new Date(m.updatedAt).toLocaleString() : '-'}
                </div>
                <div className="memory-card-actions">
                  <button className="memory-action-btn" onClick={() => handleOpenEdit(m)} title="编辑">
                    <Pencil size={14} strokeWidth={2} />
                  </button>
                  <button
                    className="memory-action-btn memory-action-delete"
                    onClick={() => handleDelete(m.id)}
                    disabled={deletingId === m.id}
                    title="删除"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="memory-pagination">
            <button
              className="memory-page-btn"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <span className="memory-page-info">
              第 {page} / {totalPages} 页
            </span>
            <button
              className="memory-page-btn"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}

      {showModal && (
        <div className="memory-modal-overlay" onClick={handleCloseModal}>
          <DialogSurface className="memory-modal" label={editingMemory ? '编辑记忆' : '新建记忆'} onClose={handleCloseModal} busy={saving}>
            <div className="memory-modal-header">
              <h1 className="dialog-title">{editingMemory ? '编辑记忆' : '新建记忆'}</h1>
              <button className="memory-modal-close" aria-label="关闭对话框" onClick={handleCloseModal}>
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className="memory-modal-body">
              {formError && <div className="memory-form-error">{formError}</div>}
              <div className="memory-form-group">
                <label htmlFor="memory-content">记忆内容 <span className="required">*</span></label>
                <textarea
                  id="memory-content"
                  rows={4}
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="输入记忆内容..."
                />
              </div>
              <div className="memory-form-row">
                <div className="memory-form-group">
                  <label htmlFor="memory-type">类型</label>
                  <SelectField id="memory-type" aria-label="记忆类型" value={formData.memoryType} onChange={(value) => setFormData({ ...formData, memoryType: value })}
                    options={Object.entries(MEMORY_TYPE_MAP).map(([value, label]) => ({ value, label }))} />
                </div>
                <div className="memory-form-group">
                  <label htmlFor="memory-scope">作用域</label>
                  <SelectField id="memory-scope" aria-label="记忆作用域" value={formData.scope} onChange={(value) => setFormData({ ...formData, scope: value })}
                    options={Object.entries(SCOPE_MAP).map(([value, label]) => ({ value, label }))} />
                </div>
                <div className="memory-form-group">
                  <label htmlFor="memory-importance">重要性</label>
                  <SelectField id="memory-importance" aria-label="记忆重要性" value={formData.importance} onChange={(value) => setFormData({ ...formData, importance: value })}
                    options={[{ value: 'HIGH', label: '高' }, { value: 'MEDIUM', label: '中' }, { value: 'LOW', label: '低' }]} />
                </div>
              </div>
              {formData.scope === 'PROJECT' && (
                <div className="memory-form-group">
                  <label>项目 ID</label>
                  <input
                    type="text"
                    value={formData.projectId}
                    onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                    placeholder="输入项目 ID"
                  />
                </div>
              )}
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

export default MemoryPanel;
