/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BookOpen, BookOpenText, Download, Layers, MoreHorizontal, PanelRightClose, PanelRightOpen, Plus, X } from 'lucide-react';
import WorkEditor from './WorkEditor';
import MessageBubble from './MessageBubble';
import InputBox from './InputBox';
import SelectField from './SelectField';
import { CandidateDialog, LegacyDialog, ProjectKnowledgeBasesDialog, WorkExportDialog, WorkspaceModal } from './WorkspaceDialogs';
import { getReading } from '../api/workspace';
import { getProjectKnowledgeBases } from '../api/projects';
import { markdownToHtml } from '../utils/markdownEditor';

const operations = [
  { value: 'DISCUSS', label: '仅对话' }, { value: 'REPLACE', label: '替换本章' },
  { value: 'APPEND', label: '追加到本章' }, { value: 'CREATE_NODE', label: '新建章节' },
];
const views = [['split', '双栏创作'], ['chat', 'Agent对话'], ['reading', '阅读视图']];

export default function ProjectWorkspace({ project, workspace, sessions, activeSession, messages, onSend, onEnsureSession,
  onSelectSession, onNewChat, onUpdateSession, onDeleteSession, onNewProject, onExport, onConversationRefresh,
  isLoading, hasContentStarted, isSessionLoading, visible, onOpenKnowledgeBases }) {
  const [selection, setSelection] = useState(null);
  const [knowledgeBasesProject, setKnowledgeBasesProject] = useState(null);
  const selectionRequest = useRef(0);
  const currentProjectId = useRef(null);
  const projectId = project?.id;
  const selectionForProject = selection?.projectId === projectId ? selection : null;
  const knowledgeBaseIds = selectionForProject?.ids;
  const knowledgeBaseLabel = knowledgeBaseIds?.length ? `知识库 ${knowledgeBaseIds.length}` : '知识库';
  const openProjectKnowledgeBases = () => setKnowledgeBasesProject(projectId);
  const closeProjectKnowledgeBases = () => setKnowledgeBasesProject(null);

  const refreshKnowledgeBases = useCallback(async () => {
    if (!projectId) return undefined;
    const request = ++selectionRequest.current;
    try {
      const { knowledgeBaseIds: ids } = await getProjectKnowledgeBases(projectId);
      if (request !== selectionRequest.current) return undefined;
      setSelection({ projectId, ids });
      return ids;
    } catch (failure) {
      if (request !== selectionRequest.current) return undefined;
      setSelection({ projectId, ids: undefined });
      throw failure;
    }
  }, [projectId]);

  const [operation, setOperation] = useState('DISCUSS');
  const [candidate, setCandidate] = useState(null);
  const [candidateList, setCandidateList] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [reading, setReading] = useState({ title: '', content: '' });
  const [readingLoading, setReadingLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [mobileAssistant, setMobileAssistant] = useState(false);
  const [sessionAction, setSessionAction] = useState(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionBusy, setSessionBusy] = useState(false);
  const tabsId = useId();
  const containerRef = useRef(null);
  const mobileTriggerRef = useRef(null);
  const assistantRef = useRef(null);
  const messagesEndRef = useRef(null);
  const resizeCleanup = useRef(null);
  const view = workspace.viewMode;
  const activeViewIndex = views.findIndex(([value]) => value === view);
  const assistantWidth = workspace.widths.split;
  const pending = workspace.candidates.filter((item) => item.status === 'PENDING');
  const sessionCandidates = workspace.candidates.filter((item) => (item.sourceSessionId || item.sessionId) === activeSession?.id);
  const visibleOperation = isLoading && workspace.taskTarget ? workspace.taskTarget.operation : operation;
  const visibleTarget = isLoading && workspace.taskTarget
    ? workspace.nodes.find((node) => node.id === workspace.taskTarget.nodeId) : workspace.activeNode;
  const targetHint = visibleTarget
    ? `${visibleTarget.title} · ${visibleOperation === 'CREATE_NODE' ? '采纳后新建章节' : '采纳后更新正文'}`
    : '请先选择正文节点';
  const setView = (next) => { setMobileAssistant(false); workspace.preferences({ viewMode: next }); };
  const closeMobileAssistant = () => { setMobileAssistant(false); mobileTriggerRef.current?.focus(); };

  useEffect(() => {
    if (visible) messagesEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, mobileAssistant, view, visible, workspace.assistantCollapsed]);
  useEffect(() => {
    if (mobileAssistant) assistantRef.current?.querySelector('[role="combobox"]')?.focus();
  }, [mobileAssistant]);
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 980px)');
    const resetDrawer = (event) => { if (!event.matches) setMobileAssistant(false); };
    narrow.addEventListener('change', resetDrawer);
    return () => narrow.removeEventListener('change', resetDrawer);
  }, []);
  useEffect(() => {
    if (!visible || view !== 'reading' || !projectId) return undefined;
    let cancelled = false;
    setReadingLoading(true);
    getReading(projectId).then((result) => { if (!cancelled) setReading({ ...result, projectId }); })
      .catch((failure) => { if (!cancelled) setLocalError(failure.message); }).finally(() => { if (!cancelled) setReadingLoading(false); });
    return () => { cancelled = true; };
  }, [view, visible, projectId, workspace.revision]);
  useEffect(() => () => resizeCleanup.current?.(), [projectId, view, visible]);
  useEffect(() => {
    setCandidate(null); setCandidateList(false); setExportOpen(false); setLocalError('');
    setMobileAssistant(false); setSessionAction(null); setOperation('DISCUSS');
  }, [projectId]);

  useEffect(() => {
    currentProjectId.current = visible ? projectId : null;
    if (!visible || !projectId) return undefined;
    refreshKnowledgeBases().catch(() => {});
    return () => { selectionRequest.current += 1; currentProjectId.current = null; };
  }, [visible, projectId, refreshKnowledgeBases]);
  useEffect(() => { setKnowledgeBasesProject(null); }, [projectId, visible]);

  const send = async (content, type, webSearch, attachments) => {
    try {
      setLocalError('');
      const knowledgeQa = type === 'KNOWLEDGE_QA';
      if (knowledgeQa) {
        if (!content.trim()) throw new Error('请先输入要检索的问题');
        const ids = await refreshKnowledgeBases();
        if (!ids) return false;
        if (ids.length === 0) {
          openProjectKnowledgeBases();
          return false;
        }
      }
      const session = await onEnsureSession();
      if (currentProjectId.current !== projectId || session.projectId !== projectId) return false;
      const target = await workspace.prepareTarget(knowledgeQa ? 'DISCUSS' : operation, session.id);
      if (currentProjectId.current !== projectId) return false;
      const outcome = await onSend(content, type, webSearch, attachments, target.baseDocumentId || '', target);
      if (outcome === false) return false;
      if (!outcome.accepted) {
        if (currentProjectId.current !== projectId) return false;
        if (knowledgeQa) {
          const ids = await refreshKnowledgeBases().catch(() => undefined);
          if (ids?.length === 0) openProjectKnowledgeBases();
        }
        throw new Error(outcome.error);
      }
      return true;
    } catch (failure) {
      if (currentProjectId.current === projectId) setLocalError(failure.message);
      return false;
    }
  };

  const resize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanup.current?.();
    const previousCursor = document.body.style.cursor, previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const move = (pointer) => {
      const width = Math.min(600, Math.max(280, containerRef.current.getBoundingClientRect().right - pointer.clientX));
      workspace.preferences({ widths: { split: width } });
    };
    const stop = () => {
      document.body.style.cursor = previousCursor; document.body.style.userSelect = previousSelect;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop);
      resizeCleanup.current = null;
    };
    resizeCleanup.current = stop;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
  };

  const submitSessionAction = async () => {
    if (!sessionAction || sessionBusy) return;
    const name = sessionTitle.trim();
    if (sessionAction.type === 'rename' && !name) return;
    setSessionBusy(true);
    try {
      const changed = sessionAction.type === 'rename'
        ? await onUpdateSession({ ...sessionAction.session, title: name })
        : await onDeleteSession(sessionAction.session);
      if (changed) setSessionAction(null);
    } finally {
      setSessionBusy(false);
    }
  };

  if (!project) return <div className="work-empty">
    <BookOpenText size={32} /><h1>从一部作品开始</h1><p>创建作品，开始写第一章。</p>
    <button className="workspace-primary" type="button" onClick={onNewProject}><Plus size={16} />新建作品</button>
  </div>;

  return <section className={`project-workspace view-${view}${workspace.assistantCollapsed ? ' assistant-collapsed' : ''}${mobileAssistant ? ' mobile-assistant' : ''}`}
    style={{ '--assistant-width': `${assistantWidth}px` }} ref={containerRef}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && mobileAssistant && !event.defaultPrevented) closeMobileAssistant();
    }}>
    <header className="workspace-header">
      <div className="workspace-project-title">
        <BookOpenText size={19} className="workspace-project-icon" />
        <h1 title={project.name}>{project.name}</h1>
        <button className="workspace-ghost project-kb-trigger" type="button" aria-label={knowledgeBaseIds?.length
          ? `绑定知识库，已选 ${knowledgeBaseIds.length} 个` : '绑定知识库'} title="绑定知识库" onClick={openProjectKnowledgeBases}>
          <BookOpen size={15} /><span>{knowledgeBaseLabel}</span>
        </button>
      </div>
      <nav className="workspace-view-tabs" role="tablist" aria-label="工作区视图" style={{ '--active-view': activeViewIndex }}>
        {views.map(([value, label], index) => <button type="button" role="tab" id={`${tabsId}-${value}`}
          key={value} aria-selected={view === value} aria-controls={`${tabsId}-panels`} tabIndex={view === value ? 0 : -1}
          onClick={() => setView(value)} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length;
            event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
            setView(views[next][0]);
          }}>{label}</button>)}
      </nav>
      <div className="workspace-header-actions">
        {isLoading && <span className="workspace-running" role="status">正在生成</span>}
        {view === 'split' && <button className="workspace-ghost workspace-mobile-toggle" type="button" ref={mobileTriggerRef}
          aria-label={mobileAssistant ? '关闭创作助手' : '打开创作助手'} title={mobileAssistant ? '关闭创作助手' : '打开创作助手'}
          aria-expanded={mobileAssistant} aria-controls={`${tabsId}-assistant`}
          onClick={() => mobileAssistant ? closeMobileAssistant() : setMobileAssistant(true)}>
          {mobileAssistant ? <X size={17} /> : <PanelRightOpen size={17} />}<span>助手</span>
        </button>}
        <button className="workspace-ghost workspace-candidates-trigger" type="button" title="作品候选"
          aria-label={pending.length ? `作品候选，${pending.length} 项待采纳` : '作品候选'}
          onClick={async () => { setCandidateList(true); await workspace.refresh(); }}>
          <Layers size={16} /><span className="workspace-action-label">候选</span>
          {pending.length > 0 && <span className="workspace-count">{pending.length}</span>}
        </button>
        <button className="workspace-ghost" type="button" title="导出作品" aria-label="导出作品" onClick={() => setExportOpen(true)}>
          <Download size={16} /><span className="workspace-action-label">导出</span>
        </button>
      </div>
    </header>
    {(workspace.error || localError) && <div className="workspace-error-banner" role="alert">{workspace.error || localError}
      <button type="button" aria-label="关闭错误提示" onClick={() => { workspace.patch({ error: '' }); setLocalError(''); }}><X size={15} /></button>
    </div>}
    <div className="workspace-panels" id={`${tabsId}-panels`} role="tabpanel" aria-labelledby={`${tabsId}-${view}`}>
      <div className="workspace-editor-pane" inert={mobileAssistant && view === 'split'}>
        <WorkEditor workspace={workspace} isLoading={isLoading} sessionId={activeSession?.id}
          onEnsureSession={onEnsureSession} onCandidate={setCandidate} onConversationRefresh={onConversationRefresh} />
      </div>
      {view === 'reading' && <section className="workspace-reading-pane" aria-label="已保存全文">
        <header><h2>{reading.projectId === projectId && reading.title || project.name}</h2></header>
        {Object.values(workspace.drafts).some((draft) => draft.dirty) && <p className="workspace-notice">全文仅显示已保存的正文。</p>}
        {readingLoading || reading.projectId !== projectId && !localError ? <p className="workspace-muted">加载全文…</p>
          : <article className="workspace-markdown" dangerouslySetInnerHTML={{
            __html: markdownToHtml(reading.projectId === projectId && reading.content || '保存正文章节后即可阅读全文。'),
          }} />}
      </section>}
      <div className="workspace-split-tools">
        {!workspace.assistantCollapsed && <div className="workspace-resizer" role="separator" aria-orientation="vertical"
          aria-label="调整助手宽度" aria-valuemin={280} aria-valuemax={600} aria-valuenow={assistantWidth} tabIndex={0}
          onPointerDown={resize} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const width = Math.min(600, Math.max(280, assistantWidth + (event.key === 'ArrowLeft' ? 20 : -20)));
            workspace.preferences({ widths: { split: width } });
          }} />}
        <button className="workspace-assistant-toggle" type="button"
          aria-label={workspace.assistantCollapsed ? '展开助手' : '收起助手'}
          title={workspace.assistantCollapsed ? '展开助手' : '收起助手'} aria-expanded={!workspace.assistantCollapsed}
          aria-controls={`${tabsId}-assistant`}
          onClick={() => workspace.preferences({ assistantCollapsed: !workspace.assistantCollapsed })}>
          {workspace.assistantCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
      </div>
      {mobileAssistant && <div className="workspace-assistant-scrim" aria-hidden="true" onClick={closeMobileAssistant} />}
      <aside className="workspace-chat-pane" aria-label="创作助手" id={`${tabsId}-assistant`} ref={assistantRef}>
        <header className="workspace-chat-header">
          <SelectField className="workspace-chat-session" aria-label="选择创作会话" menuWidth={240}
            value={activeSession?.id || ''} onChange={(value) => {
              const session = sessions.find((item) => item.id === value);
              if (session && session.id !== activeSession?.id) onSelectSession(session);
            }}
            options={[...(!activeSession || !sessions.some((item) => item.id === activeSession.id) ? [{ value: '', label: '新会话' }] : []),
              ...sessions.map((session) => ({ value: session.id, label: session.title || '新对话' }))]} />
          <details className="workspace-session-menu tree-menu" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
          }} onKeyDown={(event) => {
            if (event.key !== 'Escape' || !event.currentTarget.open) return;
            event.stopPropagation();
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }}>
            <summary aria-label="会话操作" title="会话操作"><MoreHorizontal size={19} /></summary>
            <div className="tree-menu-items">
              <button type="button" disabled={isLoading} onClick={(event) => {
                const menu = event.currentTarget.closest('details');
                menu.open = false;
                menu.querySelector('summary')?.focus();
                onNewChat();
              }}>新建会话</button>
              {activeSession && <button type="button" disabled={isLoading} onClick={(event) => {
                const menu = event.currentTarget.closest('details');
                menu.open = false;
                menu.querySelector('summary')?.focus();
                setSessionTitle(activeSession.title || '');
                setSessionAction({ type: 'rename', session: activeSession });
              }}>重命名会话</button>}
              {activeSession && <button className="danger" type="button" disabled={isLoading} onClick={(event) => {
                const menu = event.currentTarget.closest('details');
                menu.open = false;
                menu.querySelector('summary')?.focus();
                setSessionAction({ type: 'delete', session: activeSession });
              }}>删除会话</button>}
            </div>
          </details>
        </header>
        <div className="workspace-message-scroll">
          {isSessionLoading && <p className="workspace-muted">加载会话…</p>}
          {!messages.length && !isSessionLoading && <div className="workspace-chat-welcome">
            <h2>创作助手</h2><p>讨论构思、查资料，或起草章节。</p>
          </div>}
          {messages.map((message) => <MessageBubble key={message.id} message={message} onExport={onExport} />)}
          {isLoading && !hasContentStarted && <p className="workspace-muted" role="status">正在处理写作任务…</p>}
          {sessionCandidates.map((item) => <div className="workspace-candidate-card" data-candidate-id={item.id} key={item.id}>
            <div><strong>{item.operation === 'CREATE_NODE' ? item.title : workspace.nodes.find((node) => node.id === item.targetNodeId)?.title || item.title}</strong>
              <span>{item.status === 'ADOPTED' ? '已采纳' : '待采纳'}</span></div>
            <p>{item.content.slice(0, 150)}{item.content.length > 150 ? '…' : ''}</p>
            <button className="workspace-ghost" type="button" onClick={() => setCandidate(item)}>{item.status === 'ADOPTED' ? '查看修改' : '预览修改'}</button>
          </div>)}
          <div ref={messagesEndRef} />
        </div>
        <InputBox key={projectId} onSend={send} disabled={isSessionLoading || workspace.loading} isLoading={isLoading}
          sessionId={activeSession?.id || ''} target={{ value: visibleOperation, options: operations, hint: targetHint, onChange: setOperation }} />
      </aside>
    </div>
    {sessionAction && <WorkspaceModal title={sessionAction.type === 'rename' ? '重命名会话' : '删除会话'}
      onClose={() => { if (!sessionBusy) setSessionAction(null); }}
      footer={<>
        <button type="button" disabled={sessionBusy} onClick={() => setSessionAction(null)}>取消</button>
        <button type="button" className="workspace-primary" disabled={sessionBusy || sessionAction.type === 'rename' && !sessionTitle.trim()}
          onClick={submitSessionAction}>{sessionBusy ? '处理中…' : sessionAction.type === 'rename' ? '保存' : '确认删除'}</button>
      </>}>
      {sessionAction.type === 'rename' ? <label>会话名称<input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          submitSessionAction();
        }} /></label> : <p>确认删除「{sessionAction.session.title}」中的会话消息？</p>}
    </WorkspaceModal>}
    {visible && knowledgeBasesProject === projectId && <ProjectKnowledgeBasesDialog key={projectId} project={project}
      onClose={closeProjectKnowledgeBases}
      onManage={() => { closeProjectKnowledgeBases(); onOpenKnowledgeBases(); }}
      onSaved={(ids) => {
        selectionRequest.current += 1;
        setSelection({ projectId, ids });
        closeProjectKnowledgeBases();
      }} />}
    {candidate && <CandidateDialog key={candidate.id} candidate={candidate} workspace={workspace} onClose={() => setCandidate(null)} />}
    {candidateList && <WorkspaceModal title="作品候选" wide onClose={() => setCandidateList(false)}>
      {!workspace.candidates.length && <p className="workspace-muted">生成正文后，候选会出现在这里。</p>}
      <div className="workspace-candidate-list">{workspace.candidates.map((item) => <button type="button" data-candidate-id={item.id} key={item.id} onClick={() => { setCandidateList(false); setCandidate(item); }}>
        <strong>{item.title}</strong><span>{item.status === 'ADOPTED' ? '已采纳' : '待采纳'} · {sessions.find((session) => session.id === item.sourceSessionId)?.title || '历史来源会话'}</span>
      </button>)}</div>
    </WorkspaceModal>}
    {workspace.legacyOpen && <LegacyDialog workspace={workspace} onClose={() => workspace.patch({ legacyOpen: false })} />}
    {exportOpen && <WorkExportDialog project={project} workspace={workspace} sessionId={activeSession?.id} onClose={() => setExportOpen(false)} />}
  </section>;
}
