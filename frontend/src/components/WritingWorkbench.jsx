/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDocument,
  createDocumentVersion,
  editSuggestion,
  getDocumentsBySessionId,
  updateDocument,
} from '../api/documents';
import RichMarkdownEditor from './RichMarkdownEditor';
import { createSelectionFingerprint, markdownToHtml, normalizeTextForFingerprint } from '../utils/markdownEditor';
import '../styles/global.css';

const ITERATION_MODES = [
  { value: 'CONTINUE', label: '续写', fallback: '请基于当前版本继续写作，保持既有风格和结构。' },
  { value: 'POLISH', label: '润色', fallback: '请润色当前版本，提升表达质量，并保持原意不变。' },
  { value: 'CREATE', label: '重写', fallback: '请基于当前版本和我的要求重新生成一个更好的版本。' },
];

const SUGGESTION_MODES = [
  { value: 'POLISH_SELECTION', label: '润色选区', fallback: '请润色这段文字，保持原意不变。' },
  { value: 'REWRITE_SELECTION', label: '重写选区', fallback: '请基于上下文重写这段文字。' },
  { value: 'CONTINUE_AFTER_SELECTION', label: '在此后续写', fallback: '请从选区之后自然续写。' },
];

const emptyTitle = '未命名文稿';

const parseMetadata = (metadata) => {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
};

const normalizeMarkdownForCompare = (text) =>
  String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const isSameMarkdown = (a, b) => normalizeMarkdownForCompare(a) === normalizeMarkdownForCompare(b);

const formatTime = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const SOURCE_LABELS = {
  draft: '草稿',
  agent: 'Agent',
  user: '手动',
  manual: '手动',
  final: '定稿',
};

const sourceLabel = (document) => {
  const metadata = parseMetadata(document?.metadata);
  if (metadata.derivedFromVersion) return `源自 V${metadata.derivedFromVersion}`;
  if (metadata.generatedBy === 'agent') return 'Agent';
  if (metadata.createdBy === 'user') return '手动';
  return SOURCE_LABELS[document?.type] || document?.type || '草稿';
};

const buildFrozenSelection = (snapshot, document) => {
  if (!snapshot || !document) return null;
  const fingerprint = createSelectionFingerprint({
    beforeText: snapshot.beforeText,
    selectedText: snapshot.selectedText,
    afterText: snapshot.afterText,
    documentVersion: document.version,
    fullTextLength: snapshot.fullTextLength,
  });
  return {
    ...snapshot,
    fingerprint,
    documentId: document.id,
    documentVersion: document.version,
  };
};

const WritingWorkbench = ({ sessionId, isLoading, selectedKbId, documentRefresh, onIterate, collapsed = false, onCollapse, onExpand }) => {
  const [documents, setDocuments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [iterationMode, setIterationMode] = useState('CONTINUE');
  const [iterationText, setIterationText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [selectionSnapshot, setSelectionSnapshot] = useState(null);
  const [frozenSelection, setFrozenSelection] = useState(null);
  const [suggestionMode, setSuggestionMode] = useState('POLISH_SELECTION');
  const [suggestionInstruction, setSuggestionInstruction] = useState('');
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionResult, setSuggestionResult] = useState(null);
  const [suggestionError, setSuggestionError] = useState('');
  const editorRef = useRef(null);
  const dirtyRef = useRef(false);

  const selectedDocument = documents.find((doc) => doc.id === selectedId) || null;
  const selectedSuggestionMode = useMemo(
    () => SUGGESTION_MODES.find((item) => item.value === suggestionMode) || SUGGESTION_MODES[0],
    [suggestionMode]
  );

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const clearSuggestion = useCallback(() => {
    setSelectionSnapshot(null);
    setFrozenSelection(null);
    setSuggestionResult(null);
    setSuggestionError('');
    setSuggestionInstruction('');
  }, []);

  const selectDocument = useCallback((document) => {
    setSelectedId(document?.id || '');
    setTitle(document?.title || '');
    setContent(document?.content || '');
    setDirty(false);
    setError('');
    setSelectionSnapshot(null);
    clearSuggestion();
  }, [clearSuggestion]);

  const loadDocuments = useCallback(async (preferredId = '', forceSelect = false) => {
    if (!sessionId) {
      setDocuments([]);
      selectDocument(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const list = await getDocumentsBySessionId(sessionId);
      const nextDocuments = list || [];
      setDocuments(nextDocuments);
      if (forceSelect || !dirtyRef.current) {
        const preferred = nextDocuments.find((doc) => doc.id === preferredId);
        selectDocument(preferred || nextDocuments[0] || null);
      }
    } catch (e) {
      setError(e.message || '加载文稿失败');
    } finally {
      setLoading(false);
    }
  }, [sessionId, selectDocument]);

  useEffect(() => {
    setNotice('');
    setIterationText('');
    dirtyRef.current = false;
    setDirty(false);
    loadDocuments('', true);
  }, [sessionId, loadDocuments]);

  useEffect(() => {
    if (!documentRefresh?.token) return;
    loadDocuments(documentRefresh.documentId);
  }, [documentRefresh?.token, documentRefresh?.documentId, loadDocuments]);

  const markChanged = (setter) => (value) => {
    setter(value);
    setDirty(true);
    setNotice('');
  };

  // 编辑器回填（setContent / 富文本序列化）会带来格式微差，
  // 这里按归一化文本比较，避免刚打开文稿就显示「未保存」。
  const markContentChanged = (value) => {
    setContent(value);
    setNotice('');
    const base = selectedDocument?.content ?? '';
    setDirty(!isSameMarkdown(value, base));
  };

  const currentPayload = () => ({
    sessionId,
    title: title.trim() || emptyTitle,
    content,
    type: 'draft',
    format: 'markdown',
    status: 'editing',
  });

  const handleSaveAsVersion = async () => {
    if (!sessionId || saving) return null;
    setSaving(true);
    setError('');
    try {
      const metadata = {
        createdBy: 'user',
        derivedFromDocumentId: selectedDocument?.id || undefined,
        derivedFromVersion: selectedDocument?.version || undefined,
      };
      const payload = {
        ...currentPayload(),
        metadata: JSON.stringify(metadata),
      };
      const created = documents.length > 0
        ? await createDocumentVersion(sessionId, payload)
        : await createDocument(payload);
      await loadDocuments(created.id, true);
      setNotice(`已保存为 V${created.version || 1}`);
      return created;
    } catch (e) {
      setError(e.message || '保存新版本失败');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCurrent = async () => {
    if (!sessionId || saving) return null;
    if (!selectedDocument) return handleSaveAsVersion();
    setSaving(true);
    setError('');
    try {
      const payload = currentPayload();
      delete payload.sessionId;
      const updated = await updateDocument(selectedDocument.id, payload);
      setDocuments((prev) => prev.map((doc) => (doc.id === updated.id ? updated : doc)));
      selectDocument(updated);
      setNotice(`V${updated.version} 已保存`);
      return updated;
    } catch (e) {
      setError(e.message || '保存失败');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleCreateBlank = async () => {
    if (!sessionId || saving) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        sessionId,
        title: emptyTitle,
        content: '',
        type: 'draft',
        format: 'markdown',
        status: 'editing',
        metadata: JSON.stringify({ createdBy: 'user' }),
      };
      const created = documents.length > 0
        ? await createDocumentVersion(sessionId, payload)
        : await createDocument(payload);
      await loadDocuments(created.id, true);
      setNotice(`已创建 V${created.version || 1}`);
    } catch (e) {
      setError(e.message || '新建文稿失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectVersion = (document) => {
    if (dirty && !window.confirm('当前版本有未保存修改，切换后会丢失这些修改。继续切换吗？')) {
      return;
    }
    selectDocument(document);
  };

  const handleIterate = async () => {
    if (!sessionId || isLoading || saving) return;
    let activeDocument = selectedDocument;
    if (dirty || !activeDocument) {
      activeDocument = await handleSaveCurrent();
    }
    if (!activeDocument?.id) return;

    const selectedMode = ITERATION_MODES.find((item) => item.value === iterationMode) || ITERATION_MODES[0];
    const instruction = iterationText.trim() || selectedMode.fallback;
    await onIterate?.(instruction, selectedMode.value, true, selectedKbId, [], activeDocument.id);
    setIterationText('');
    setNotice('已提交迭代');
  };

  const handleSelectionChange = (snapshot) => {
    setSelectionSnapshot(snapshot);
    if (suggestionResult) {
      setSuggestionResult(null);
      setFrozenSelection(null);
    }
  };

  const requestSuggestion = async (mode = suggestionMode) => {
    if (!sessionId) return;
    if (!selectedDocument?.id) {
      setSuggestionError('请先保存文稿，再使用选区建议。');
      return;
    }
    if (!selectionSnapshot?.selectedText) {
      setSuggestionError('请先选中一段文字。');
      return;
    }

    const frozen = buildFrozenSelection(selectionSnapshot, selectedDocument);
    const selectedMode = SUGGESTION_MODES.find((item) => item.value === mode) || SUGGESTION_MODES[0];
    setFrozenSelection(frozen);
    setSuggestionMode(selectedMode.value);
    setSuggestionResult(null);
    setSuggestionError('');
    setSuggestionLoading(true);
    try {
      const result = await editSuggestion(selectedDocument.id, {
        mode: selectedMode.value,
        instruction: suggestionInstruction.trim() || selectedMode.fallback,
        title: title.trim() || emptyTitle,
        selectedText: frozen.selectedText,
        selectedMarkdown: frozen.selectedMarkdown,
        beforeText: frozen.beforeText,
        afterText: frozen.afterText,
        selectionFingerprint: frozen.fingerprint,
        clientDocumentVersion: frozen.documentVersion,
      });
      setSuggestionResult(result);
    } catch (e) {
      setSuggestionError(e.message || '生成选区建议失败');
    } finally {
      setSuggestionLoading(false);
    }
  };

  const validateFrozenSelection = () => {
    const editor = editorRef.current;
    if (!editor || !frozenSelection || !selectedDocument) return false;
    if (frozenSelection.documentId !== selectedDocument.id) return false;
    if (frozenSelection.documentVersion !== selectedDocument.version) return false;

    const { from, to } = frozenSelection;
    if (from < 0 || to > editor.state.doc.content.size || from >= to) return false;

    const selectedText = editor.state.doc.textBetween(from, to, '\n').trim();
    const beforeText = editor.state.doc.textBetween(Math.max(0, from - 1500), from, '\n');
    const afterText = editor.state.doc.textBetween(to, Math.min(editor.state.doc.content.size, to + 1500), '\n');
    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
    const fingerprint = createSelectionFingerprint({
      beforeText,
      selectedText,
      afterText,
      documentVersion: selectedDocument.version,
      fullTextLength: fullText.length,
    });

    return normalizeTextForFingerprint(selectedText) === normalizeTextForFingerprint(frozenSelection.selectedText)
      && fingerprint === frozenSelection.fingerprint;
  };

  const handleAcceptSuggestion = () => {
    const editor = editorRef.current;
    const replacementMarkdown = suggestionResult?.replacementMarkdown || '';
    if (!editor || !replacementMarkdown.trim()) return;
    if (!validateFrozenSelection()) {
      setSuggestionError('文稿已变化，请重新选择文本生成建议。');
      return;
    }

    const html = markdownToHtml(replacementMarkdown);
    if (suggestionResult.mode === 'CONTINUE_AFTER_SELECTION') {
      editor.chain().focus().setTextSelection(frozenSelection.to).insertContent(html).run();
    } else {
      editor.chain().focus().setTextSelection({ from: frozenSelection.from, to: frozenSelection.to }).insertContent(html).run();
    }
    clearSuggestion();
    setNotice('已应用选区建议，记得保存');
  };

  const canSave = !!sessionId && !saving && (dirty || !selectedDocument);
  const canIterate = !!sessionId && !isLoading && !saving && (selectedDocument || content.trim());
  const canRequestSuggestion = !!sessionId && !!selectedDocument?.id && !!selectionSnapshot?.selectedText && !suggestionLoading;
  const canAcceptSuggestion = !!suggestionResult?.replacementMarkdown && !suggestionLoading;

  const showEmptyState = !sessionId
    || (documents.length === 0 && !selectedDocument && !content.trim() && !dirty);

  const renderHeader = (stateLabel, stateClass = '') => (
    <div className="workbench-header">
      <div className="workbench-heading">
        <h2>版本工作台</h2>
        <span className={`workbench-state${stateClass ? ` ${stateClass}` : ''}`}>{stateLabel}</span>
      </div>
      <div className="workbench-header-actions">
        {!showEmptyState && (
          <>
            <button
              className="workbench-icon-btn"
              type="button"
              onClick={handleSaveCurrent}
              disabled={!canSave}
              title={dirty ? '保存到当前版本' : '没有未保存的修改'}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            </button>
            <button
              className="workbench-icon-btn"
              type="button"
              onClick={handleSaveAsVersion}
              disabled={!sessionId || saving}
              title="另存为新版本"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </>
        )}
        <button className="workbench-icon-btn" type="button" onClick={() => loadDocuments(selectedId)} title="刷新版本">↻</button>
        <button className="workbench-icon-btn" type="button" onClick={onCollapse} title="收起工作台">›</button>
      </div>
    </div>
  );

  if (collapsed) {
    return (
      <aside className="writing-workbench collapsed">
        <button className="workbench-rail-button" type="button" onClick={onExpand} title="展开版本工作台">
          <span className="workbench-rail-icon">⟨</span>
          <span className="workbench-rail-text">版本工作台</span>
          {dirty && <span className="workbench-rail-dot" title="有未保存修改" />}
        </button>
      </aside>
    );
  }

  if (showEmptyState) {
    return (
      <aside className="writing-workbench">
        {renderHeader(sessionId ? '暂无文稿' : '空工作台', 'idle')}
        <div className="workbench-empty">
          <div className="workbench-empty-icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
          </div>
          <h3>{sessionId ? '这个会话还没有文稿' : '这里会存放你的文稿'}</h3>
          <p>
            {sessionId
              ? '让 Agent 在中间起草，结果会作为 V1 出现在这里；也可以先手写一份空白稿。'
              : '直接在中间输入框开始写，或从左侧选一个会话；每一版文稿都会留在这里。'}
          </p>
          {sessionId && (
            <button className="workbench-empty-cta" type="button" onClick={handleCreateBlank} disabled={saving}>
              {saving ? '创建中…' : '新建空白文稿'}
            </button>
          )}
          <ul className="workbench-empty-list">
            <li>每轮迭代自动沉淀为新版本</li>
            <li>可回到任意历史版本继续改</li>
            <li>选中段落后可单独润色 / 重写</li>
          </ul>
        </div>
      </aside>
    );
  }

  return (
    <aside className="writing-workbench">
      {renderHeader(dirty ? '未保存' : '已同步', dirty ? 'dirty' : '')}

      <div className={`version-strip${documents.length === 0 ? ' is-empty' : ''}`}>
        {loading ? (
          <span className="workbench-muted">加载版本中…</span>
        ) : documents.length === 0 ? (
          <span className="workbench-muted">暂无版本</span>
        ) : (
          documents.map((document) => (
            <button
              key={document.id}
              type="button"
              className={`version-chip${document.id === selectedId ? ' active' : ''}`}
              onClick={() => handleSelectVersion(document)}
              title={`${document.title} · V${document.version} · ${sourceLabel(document)}`}
            >
              <span>V{document.version}</span>
              <small>{sourceLabel(document)}</small>
            </button>
          ))
        )}
      </div>

      <div className="workbench-editor">
        <input
          className="workbench-title-input"
          value={title}
          onChange={(event) => markChanged(setTitle)(event.target.value)}
          placeholder="文稿标题"
          disabled={!sessionId}
        />

        <div className="workbench-toolbar">
          <div className="selection-tools" aria-label="选区 AI 建议">
            {SUGGESTION_MODES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={suggestionMode === item.value ? 'active' : ''}
                disabled={!canRequestSuggestion}
                onClick={() => requestSuggestion(item.value)}
                title={!selectedDocument?.id ? '请先保存文稿' : '选中文本后生成建议'}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="workbench-toolbar-hint">
            {selectionSnapshot?.selectedText ? `已选 ${selectionSnapshot.selectedText.length} 字` : '选中文字可润色 / 重写'}
          </span>
        </div>

        <RichMarkdownEditor
          value={content}
          disabled={!sessionId}
          onChange={markContentChanged}
          onSelectionSnapshot={handleSelectionChange}
          onEditorReady={(editor) => {
            editorRef.current = editor;
          }}
        />

        {(selectionSnapshot || suggestionResult || suggestionLoading || suggestionError) && (
          <div className="selection-suggestion-panel">
            <div className="suggestion-panel-header">
              <div>
                <strong>选区 AI 建议</strong>
                <span>{selectionSnapshot?.selectedText ? `已选 ${selectionSnapshot.selectedText.length} 字` : '先选中文本'}</span>
              </div>
              <button type="button" onClick={clearSuggestion} disabled={suggestionLoading}>关闭</button>
            </div>

            <textarea
              className="suggestion-instruction"
              value={suggestionInstruction}
              onChange={(event) => setSuggestionInstruction(event.target.value)}
              placeholder={`${selectedSuggestionMode.label}的补充要求，可留空`}
              disabled={suggestionLoading}
            />

            <div className="suggestion-actions">
              <button type="button" onClick={() => requestSuggestion(suggestionMode)} disabled={!canRequestSuggestion}>
                {suggestionLoading ? '生成中…' : `生成${selectedSuggestionMode.label}`}
              </button>
              <button type="button" onClick={handleAcceptSuggestion} disabled={!canAcceptSuggestion}>接受</button>
              <button type="button" onClick={clearSuggestion} disabled={suggestionLoading}>拒绝</button>
            </div>

            {frozenSelection?.selectedText && (
              <div className="suggestion-original">
                <small>原文</small>
                <p>{frozenSelection.selectedText}</p>
              </div>
            )}

            {suggestionResult?.replacementMarkdown && (
              <div className="suggestion-replacement">
                <small>建议</small>
                <pre>{suggestionResult.replacementMarkdown}</pre>
              </div>
            )}

            {suggestionError && <div className="suggestion-error">{suggestionError}</div>}
          </div>
        )}
      </div>

      <div className="iteration-panel">
        <div className="iteration-head">
          <span className="iteration-label">整篇迭代</span>
          <div className="iteration-modes">
            {ITERATION_MODES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={iterationMode === item.value ? 'active' : ''}
                onClick={() => setIterationMode(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <textarea
          className="iteration-input"
          value={iterationText}
          onChange={(event) => setIterationText(event.target.value)}
          placeholder="写下这一轮要怎么改，例如「把第二段压缩到 100 字」…"
          disabled={!sessionId || isLoading}
        />
        <button className="iteration-submit" type="button" onClick={handleIterate} disabled={!canIterate}>
          {isLoading
            ? '生成中…'
            : iterationMode === 'POLISH'
              ? '提交润色'
              : iterationMode === 'CREATE'
                ? '提交重写'
                : '提交续写'}
        </button>
      </div>

      {(notice || error || selectedDocument) && (
        <div className={`workbench-footer-note${error ? ' error' : ''}`}>
          {error || notice || `最后修改 ${formatTime(selectedDocument?.updatedAt)}`}
        </div>
      )}
    </aside>
  );
}


export default WritingWorkbench;
