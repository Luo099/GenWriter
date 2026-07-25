import { useState, useEffect, useCallback } from 'react';
import { useConfirm } from './ui/ConfirmDialog';
import * as knowledgeBasesApi from '../api/knowledgeBases';
import * as knowledgeChunksApi from '../api/knowledgeChunks';
import * as ragApi from '../api/rag';
import '../styles/global.css';
import { ChevronLeft, Trash2, Upload } from 'lucide-react';

const STRATEGY_MAP = {
  recursive: '递归分块',
  fixed: '固定长度',
  semantic: '语义分块',
};

const KnowledgeBaseDetail = ({ kbId, onBack }) => {
  const confirm = useConfirm();
  const [knowledgeBase, setKnowledgeBase] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [strategy, setStrategy] = useState('recursive');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const fetchChunks = useCallback(async () => {
    setLoading(true);
    try {
      const result = await knowledgeChunksApi.getChunksByKnowledgeBase(kbId);
      const list = Array.isArray(result) ? result : result?.items || [];
      setChunks(list);
    } catch (e) {
      setError('加载知识片段失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [kbId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const kb = await knowledgeBasesApi.getKnowledgeBaseById(kbId);
        if (!cancelled) setKnowledgeBase(kb);
      } catch (e) {
        if (!cancelled) setError('加载知识库失败: ' + e.message);
      }
      try {
        const result = await knowledgeChunksApi.getChunksByKnowledgeBase(kbId);
        if (!cancelled) {
          const list = Array.isArray(result) ? result : result?.items || [];
          setChunks(list);
        }
      } catch (e) {
        if (!cancelled) setError('加载知识片段失败: ' + e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [kbId]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setUploadError(null);
      setUploadSuccess(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadError('请先选择文件');
      return;
    }
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(false);
    try {
      await ragApi.uploadDocument(selectedFile, kbId, strategy);
      setUploadSuccess(true);
      setSelectedFile(null);
      // 重置文件输入
      const fileInput = document.getElementById('kb-upload-input');
      if (fileInput) fileInput.value = '';
      fetchChunks();
    } catch (e) {
      setUploadError(e.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteChunk = async (chunkId) => {
    if (!await confirm('确定要删除这个知识片段吗？')) return;
    try {
      await knowledgeChunksApi.deleteChunk(chunkId);
      fetchChunks();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleClearAll = async () => {
    if (!await confirm(`确定要清空"${knowledgeBase?.name}"的所有知识片段吗？此操作不可恢复。`)) return;
    try {
      await knowledgeChunksApi.deleteChunksByKnowledgeBase(kbId);
      fetchChunks();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="memory-panel">
      <div className="memory-panel-header">
        <div className="memory-panel-header-left">
          <button className="memory-back-btn" onClick={onBack} title="返回">
            <ChevronLeft size={18} strokeWidth={2} />
          </button>
          <h2 className="memory-panel-title">
            {knowledgeBase?.name || '知识库详情'}
          </h2>
          <span className="memory-panel-count">共 {chunks.length} 个片段</span>
        </div>
        {chunks.length > 0 && (
          <button className="memory-new-btn kb-clear-btn" onClick={handleClearAll}>
            <Trash2 size={16} strokeWidth={2} />
            清空片段
          </button>
        )}
      </div>

      {/* 上传区域 */}
      <div className="panel-section kb-upload-section">
        <div className="kb-upload-row">
          <input
            id="kb-upload-input"
            type="file"
            onChange={handleFileChange}
            className="visually-hidden-file"
            accept=".txt,.md,.pdf,.doc,.docx"
          />
          <label
            htmlFor="kb-upload-input"
            className="kb-upload-label"
          >
            <Upload size={16} strokeWidth={2} />
            {selectedFile ? selectedFile.name : '选择文件'}
          </label>

          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="memory-filter-select no-margin"
          >
            {Object.entries(STRATEGY_MAP).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          <button
            className="memory-new-btn no-margin"
            onClick={handleUpload}
            disabled={uploading || !selectedFile}
          >
            {uploading ? (
              <>
                <div className="loading-spinner kb-spinner-sm"></div>
                上传中...
              </>
            ) : (
              <>
                <Upload size={16} strokeWidth={2} />
                上传文档
              </>
            )}
          </button>
        </div>

        {uploadError && (
          <div className="kb-upload-hint kb-upload-hint-error">{uploadError}</div>
        )}
        {uploadSuccess && (
          <div className="kb-upload-hint kb-upload-hint-success">上传成功，正在处理中...</div>
        )}
      </div>

      {error && (
        <div className="memory-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {loading && chunks.length === 0 ? (
        <div className="memory-loading">
          <div className="loading-spinner"></div>
          <p>加载中...</p>
        </div>
      ) : chunks.length === 0 ? (
        <div className="memory-empty">
          <p>暂无知识片段</p>
          <span>上传文档后，系统会自动解析并生成分块</span>
        </div>
      ) : (
        <>
          <div className="memory-table-header kb-grid-3col">
            <span>内容预览</span>
            <span>创建时间</span>
            <span>操作</span>
          </div>
          <div className="memory-list">
            {chunks.map((chunk) => (
              <div
                key={chunk.id}
                className="memory-card kb-grid-3col-card"
              >
                <div className="memory-card-content" title={chunk.content}>
                  {chunk.content?.substring(0, 120)}
                  {chunk.content?.length > 120 ? '...' : ''}
                </div>
                <div className="memory-card-updated">
                  {chunk.createdAt ? new Date(chunk.createdAt).toLocaleString() : '-'}
                </div>
                <div className="memory-card-actions">
                  <button
                    className="memory-action-btn memory-action-delete"
                    onClick={() => handleDeleteChunk(chunk.id)}
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
    </div>
  );
};

export default KnowledgeBaseDetail;
