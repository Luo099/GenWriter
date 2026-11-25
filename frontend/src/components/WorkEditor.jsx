import { useCallback, useEffect, useRef, useState } from 'react';
import { DOMParser, DOMSerializer } from '@tiptap/pm/model';
import { PanelRightClose, PanelRightOpen, Type } from 'lucide-react';
import RichMarkdownEditor from './RichMarkdownEditor';
import VersionNavigator from './VersionNavigator';
import { editSuggestion } from '../api/documents';
import { proposeSnapshot } from '../api/workspace';
import { createSelectionFingerprint, htmlToMarkdown, markdownToHtml } from '../utils/markdownEditor';

export default function WorkEditor({ workspace, isLoading, sessionId, onEnsureSession, onCandidate, onConversationRefresh }) {
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [formattingOpen, setFormattingOpen] = useState(false);
  const editorRef = useRef(null);
  const node = workspace.activeNode;
  const draft = workspace.drafts[node?.id];
  const versions = workspace.versions[node?.id] || [];
  const selectedId = workspace.selectedVersions[node?.id] || node?.currentDocumentId || '';
  const selected = versions.find((document) => document.id === selectedId);
  const historical = Boolean(selected && selected.id !== node?.currentDocumentId);
  const content = historical ? selected.content || '' : draft?.content || '';
  const title = historical ? selected.title || node.title : draft?.title ?? node?.title ?? '';
  const ready = Boolean(node && draft);
  const documentKey = node ? `${node.id}:${historical ? selectedId : 'current'}` : undefined;
  const activeDocumentRef = useRef(documentKey);
  useEffect(() => { activeDocumentRef.current = documentKey; }, [documentKey]);
  const onEditorReady = useCallback((editor) => { editorRef.current = editor; }, []);
  const status = historical ? '历史快照 · 只读' : draft?.dirty ? '有未保存修改' : node?.currentDocumentId ? '已保存' : '尚未保存';
  const canSave = ready && !saving && !selectionLoading && (historical ? !draft.dirty : draft.dirty || !node.currentDocumentId);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setFeedback(null);
    try {
      await workspace.save(node.id, sessionId, historical
        ? { title: node.title, content, baseDocumentId: node.currentDocumentId } : undefined);
    } catch (failure) {
      setFeedback({ nodeId: node.id, message: failure.message });
    } finally {
      setSaving(false);
    }
  };

  const selectionSuggestion = async (mode, instruction, frozen) => {
    const editor = editorRef.current;
    if (!frozen || !editor || !ready || historical || isLoading || saving || selectionLoading) return;
    const frozenDoc = editor.state.doc;
    setSelectionLoading(true);
    setFeedback(null);
    try {
      const source = await onEnsureSession();
      if (source.projectId !== workspace.projectId) throw new Error('作品已切换，请重新选择正文');
      const document = draft.dirty || !selected ? await workspace.save(node.id, source.id) : selected;
      const result = await editSuggestion(document.id, { mode, instruction: instruction || '保持上下文连贯，按选区操作修改', title,
        selectedText: frozen.selectedText, selectedMarkdown: frozen.selectedMarkdown, beforeText: frozen.beforeText, afterText: frozen.afterText,
        selectionFingerprint: createSelectionFingerprint({ ...frozen, documentVersion: document.version }), clientDocumentVersion: document.version });
      if (activeDocumentRef.current !== documentKey || !editor.state.doc.eq(frozenDoc)) {
        throw new Error('正文已变化，请重新选择后生成建议');
      }
      const fragment = window.document.createElement('div');
      fragment.innerHTML = markdownToHtml(result.replacementMarkdown);
      const slice = DOMParser.fromSchema(editor.schema).parseSlice(fragment);
      const transaction = mode === 'CONTINUE_AFTER_SELECTION' ? editor.state.tr.insert(frozen.to, slice.content)
        : editor.state.tr.replaceRange(frozen.from, frozen.to, slice);
      const container = window.document.createElement('div');
      container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(transaction.doc.content));
      const candidate = await proposeSnapshot(workspace.projectId, { nodeId: node.id, baseDocumentId: document.id, title,
        content: htmlToMarkdown(container.innerHTML), instruction: `${mode}: ${instruction || '选区修改'}`, sourceSessionId: source.id });
      await workspace.refresh();
      if (activeDocumentRef.current === documentKey) {
        onConversationRefresh?.();
        onCandidate(candidate);
      }
    } catch (failure) {
      setFeedback({ nodeId: node.id, message: failure.message });
    } finally {
      setSelectionLoading(false);
    }
  };

  return <section className="work-editor" data-node-id={node?.id} aria-busy={!ready || saving || selectionLoading} aria-label="作品正文编辑器">
    <header className="work-editor-heading">
      <div className="work-editor-breadcrumb">
        <h2 title={node?.title}>{node?.title || '正文'}</h2>
        <span className={`workspace-save-state${draft?.dirty && !historical ? ' is-dirty' : ''}`} role="status">{status}</span>
      </div>
      <div className="work-editor-actions">
        {ready && !historical && <button className="workspace-ghost work-format-toggle" type="button" aria-label="排版工具"
          title="排版工具" aria-expanded={formattingOpen} onClick={() => setFormattingOpen((current) => !current)}>
          <Type size={16} /><span>排版</span>
        </button>}
        <VersionNavigator documents={versions} selectedId={selectedId} dirty={Boolean(draft?.dirty)} loading={!ready && workspace.loading}
          onSelect={(document) => workspace.patch((current) => ({
            selectedVersions: { ...current.selectedVersions, [node.id]: document.id === node.currentDocumentId ? null : document.id },
          }))} />
        <button className="workspace-primary work-save-button" type="button" disabled={!canSave}
          title={historical && draft?.dirty ? '请先保存当前正文的修改' : historical ? '将此版正文保存为新快照' : '保存快照（Ctrl / ⌘ + S）'} onClick={save}>
          {saving ? '保存中…' : historical ? '恢复正文' : '保存'}
        </button>
        {workspace.mode === 'studio' && <button className="workspace-icon-button" type="button"
          aria-label={workspace.assistantCollapsed ? '展开助手' : '收起助手'}
          onClick={() => workspace.preferences({ assistantCollapsed: !workspace.assistantCollapsed })}>
          {workspace.assistantCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>}
      </div>
    </header>
    <div className="work-editor-scroll" onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !event.nativeEvent.isComposing) {
        event.preventDefault();
        save();
      }
    }}>
      <div className="work-editor-page">
        {historical && draft?.dirty && <p className="workspace-notice">当前正文有未保存修改，切回当前版本保存后可恢复此快照。</p>}
        {feedback?.nodeId === node?.id && feedback?.message && <p className="workspace-error" role="alert">{feedback.message}</p>}
        <RichMarkdownEditor documentKey={documentKey} value={content}
          onChange={(value) => { if (node && !historical) workspace.updateDraft(node.id, { content: value }); }}
          disabled={!ready || historical || saving || selectionLoading} toolbarOpen={formattingOpen && !historical}
          placeholder="从这里开始写作…" onEditorReady={onEditorReady}
          onSelectionAction={selectionSuggestion} selectionLoading={isLoading || selectionLoading}>
          <input className="workbench-title-input" aria-label="正文标题" value={title} placeholder="正文标题" disabled={!ready || historical || selectionLoading}
            onChange={(event) => workspace.updateDraft(node.id, { title: event.target.value })} />
        </RichMarkdownEditor>
      </div>
    </div>
    <footer className="work-editor-footer"><span>{content.replace(/\s/g, '').length} 字</span>
      {selectionLoading && <span role="status">正在生成选区候选…</span>}
    </footer>
  </section>;
}
