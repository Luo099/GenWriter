import { useState, useRef, useEffect, useCallback } from 'react';
import AttachmentPreview from './AttachmentPreview';
import SelectField from './SelectField';
import { uploadAttachment, deleteAttachment, getThumbnailUrl } from '../api/attachments';
import { ArrowUp, Globe2, Paperclip } from 'lucide-react';

const MODES = [
  { value: 'AUTO', label: '自动' },
  { value: 'CREATE', label: '创作' },
  { value: 'CONTINUE', label: '续写' },
  { value: 'POLISH', label: '润色' },
  { value: 'KNOWLEDGE_QA', label: '知识问答' },
];

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'json', 'xml'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_DOC_SIZE = 50 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

const InputBox = ({ onSend, disabled, isLoading, sessionId = '', target }) => {
  const [inputValue, setInputValue] = useState('');
  const [mode, setMode] = useState('AUTO');
  const [webSearch, setWebSearch] = useState(true);
  const [attachments, setAttachments] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [inputValue]);

  const validateFile = (file) => {
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isDoc = ALLOWED_DOC_EXTENSIONS.includes(ext);

    if (!isImage && !isDoc) {
      return '不支持的文件类型';
    }
    if (isImage && file.size > MAX_IMAGE_SIZE) {
      return '图片大小不能超过 20MB';
    }
    if (isDoc && file.size > MAX_DOC_SIZE) {
      return '文档大小不能超过 50MB';
    }
    return null;
  };

  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      alert(`单次消息最多携带 ${MAX_ATTACHMENTS} 个附件`);
      return;
    }
    if (!sessionId) {
      alert('请先创建会话');
      return;
    }

    setIsUploading(true);
    for (const file of files) {
      const error = validateFile(file);
      if (error) {
        alert(`${file.name}: ${error}`);
        continue;
      }

      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const att = {
        id: null,
        tempId,
        originalFilename: file.name,
        fileSize: file.size,
        attachmentType: ALLOWED_IMAGE_TYPES.includes(file.type) ? 'IMAGE' : 'DOCUMENT',
        mimeType: file.type,
        thumbnailUrl: null,
        uploadProgress: 0,
        error: null,
        rawFile: file,
      };
      setAttachments((prev) => [...prev, att]);

      try {
        const result = await uploadAttachment(file, sessionId, (progress) => {
          setAttachments((prev) =>
            prev.map((a) =>
              a.tempId === tempId ? { ...a, uploadProgress: progress } : a
            )
          );
        });
        setAttachments((prev) =>
          prev.map((a) =>
            a.tempId === tempId
              ? {
                  ...a,
                  id: result.id,
                  uploadProgress: 100,
                  thumbnailUrl: a.attachmentType === 'IMAGE' ? getThumbnailUrl(result.id) : null,
                }
              : a
          )
        );
      } catch (e) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.tempId === tempId
              ? { ...a, error: e.message }
              : a
          )
        );
      }
    }
    setIsUploading(false);
  };

  const handleRemoveAttachment = useCallback(async (attIdOrTempId) => {
    const att = attachments.find(
      (a) => a.id === attIdOrTempId || a.tempId === attIdOrTempId
    );
    if (att && att.id && !att.error) {
      try {
        await deleteAttachment(att.id, sessionId);
      } catch {
        // ignore delete error on server side
      }
    }
    setAttachments((prev) =>
      prev.filter((a) => a.id !== attIdOrTempId && a.tempId !== attIdOrTempId)
    );
  }, [attachments, sessionId]);

  const handleRetryAttachment = useCallback(async (att) => {
    if (!att.rawFile || !sessionId) return;
    const tempId = att.tempId;
    // Reset the attachment state
    setAttachments((prev) =>
      prev.map((a) =>
        a.tempId === tempId
          ? { ...a, uploadProgress: 0, error: null }
          : a
      )
    );
    try {
      const result = await uploadAttachment(att.rawFile, sessionId, (progress) => {
        setAttachments((prev) =>
          prev.map((a) =>
            a.tempId === tempId ? { ...a, uploadProgress: progress } : a
          )
        );
      });
      setAttachments((prev) =>
        prev.map((a) =>
          a.tempId === tempId
            ? {
                ...a,
                id: result.id,
                uploadProgress: 100,
                thumbnailUrl: a.attachmentType === 'IMAGE' ? getThumbnailUrl(result.id) : null,
              }
            : a
        )
      );
    } catch (e) {
      setAttachments((prev) =>
        prev.map((a) =>
          a.tempId === tempId
            ? { ...a, error: e.message }
            : a
        )
      );
    }
  }, [sessionId]);

  const handleSubmit = async () => {
    const trimmed = inputValue.trim();
    const hasContent = trimmed || attachments.some((a) => a.id && !a.error);
    if (!hasContent || isLoading || disabled || isUploading || submitting.current) return;

    const attachmentIds = attachments
      .filter((a) => a.id && !a.error)
      .map((a) => a.id);

    submitting.current = true;
    try {
      const accepted = await onSend(trimmed, mode, webSearch, attachmentIds);
      if (accepted === false) return;
      setInputValue((current) => current.trim() === trimmed ? '' : current);
      setAttachments((current) => current.filter((attachment) => !attachmentIds.includes(attachment.id)));
    } finally {
      submitting.current = false;
    }
  };

  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = (e) => {
    handleFileUpload(Array.from(e.target.files));
    e.target.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    handleFileUpload(files);
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      handleFileUpload(imageFiles);
    }
  };

  const canSend = (inputValue.trim() || attachments.some((a) => a.id && !a.error)) && !isLoading && !disabled && !isUploading;
  const knowledgeQa = mode === 'KNOWLEDGE_QA';
  const targetHint = knowledgeQa
    ? '知识问答只回复会话'
    : target?.value !== 'DISCUSS' ? target?.hint : '';

  return (
    <div className="input-container">
      <div
        className={`input-wrapper${isDragOver ? ' drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.doc,.docx,.txt,.md,.csv,.json,.xml"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <textarea
          ref={textareaRef}
          className="input-textarea"
          aria-label="给助手发消息"
          placeholder={knowledgeQa ? '输入要检索的问题…' : '给助手发消息…'}
          title="Enter 发送，Shift + Enter 换行"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled || isLoading}
          rows={1}
        />
        <AttachmentPreview attachments={attachments} onRemove={handleRemoveAttachment} onRetry={handleRetryAttachment} />
        {targetHint && <p className="composer-target-hint" title={targetHint} role="status">{targetHint}</p>}
        <div className="composer-controls">
          <div className="composer-options">
            {target && <SelectField className="composer-target" aria-label="写入目标" menuWidth={188}
              value={knowledgeQa ? 'DISCUSS' : target.value} options={target.options}
              disabled={disabled || isLoading || knowledgeQa} onChange={target.onChange} />}
            <SelectField className="composer-mode" aria-label="创作模式" menuWidth={148}
              value={mode} options={MODES} disabled={disabled || isLoading} onChange={setMode} />
          </div>
          <div className="composer-actions">
            <button
              aria-label="联网搜索"
              aria-pressed={webSearch}
              className="composer-web"
              onClick={() => setWebSearch((current) => !current)}
              disabled={disabled || isLoading}
              type="button"
              title={webSearch ? '联网搜索已开启' : '联网搜索已关闭'}
            >
              <Globe2 size={15} />
              <span>联网</span>
            </button>
            <button className="attachment-btn" type="button" aria-label="添加附件" title="添加附件"
              disabled={disabled || isUploading || isLoading} onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={16} />
            </button>
            <button aria-label="发送消息" title="发送消息" className="send-btn" type="button" onClick={handleSubmit} disabled={!canSend}>
              <ArrowUp size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InputBox;
