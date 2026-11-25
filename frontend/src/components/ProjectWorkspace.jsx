/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BookOpen, BookOpenText, Download, Layers, MoreHorizontal, PanelRightClose, PanelRightOpen, Plus, X } from 'lucide-react';
import WorkEditor from './WorkEditor';
import MessageBubble from './MessageBubble';
import InputBox from './InputBox';
import SelectField from './SelectField';
import { CandidateDialog, ChangeSetDialog, LegacyDialog, ProjectKnowledgeBasesDialog, WorkExportDialog, WorkspaceModal } from './WorkspaceDialogs';
import { getReading } from '../api/workspace';
import { getProjectKnowledgeBases } from '../api/projects';
import { getWritingOutputSettings } from '../api/settings';
import { markdownToHtml } from '../utils/markdownEditor';

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

  const [assistantMode, setAssistantMode] = useState('CHAT');
  const [applyMode, setApplyMode] = useState('DIRECT_SNAPSHOT');
  const [candidate, setCandidate] = useState(null);
  const [changeSet, setChangeSet] = useState(null);
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
  const pendingCandidates = workspace.candidates.filter((item) => item.status === 'PENDING');
  const pendingChangeSets = (workspace.changeSets || []).filter((item) => item.status === 'PENDING');
  const pendingCount = pendingCandidates.length + pendingChangeSets.length;
  const sessionCandidates = workspace.candidates.filter((item) => (item.sourceSessionId || item.sessionId) === activeSession?.id);
  const sessionChangeSets = (workspace.changeSets || []).filter((item) => (item.sourceSessionId || item.sessionId) === activeSession?.id);
  const visibleTarget = workspace.activeNode;
  const activeDraft = visibleTarget ? workspace.drafts[visibleTarget.id] : null;
  const targetHint = !visibleTarget
    ? '请先选择正文节点'
    : assistantMode === 'GHOSTWRITE'
      ? `代笔 · ${visibleTarget.title} · ${applyMode === 'STAGED_CANDIDATE' ? '待审变更（审 Diff 后采纳）' : '直接写入（保留快照可撤销）'}`
      : `对话（只读）· ${visibleTarget.title}${activeDraft?.dirty ? ' · 含未保存草稿' : ''}`;
  const setView = (next) => { setMobileAssistant(false); workspace.preferences({ viewMode: next }); };
  const closeMobileAssistant = () => { setMobileAssistant(false); mobileTriggerRef.current?.focus(); };

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    getWritingOutputSettings()
      .then((settings) => {
        if (!cancelled && settings?.ghostwriteApplyMode) {
          setApplyMode(settings.ghostwriteApplyMode);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible, projectId]);

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
    setCandidate(null); setChangeSet(null); setCandidateList(false); setExportOpen(false); setLocalError('');
    setMobileAssistant(false); setSessionAction(null); setAssistantMode('CHAT');
  }, [projectId]);

  useEffect(() => {
    currentProjectId.current = visible ? projectId : null;
    if (!visible || !projectId) return undefined;
    refreshKnowledgeBases().catch(() => {});
    return () => { selectionRequest.current += 1; currentProjectId.current = null; };
  }, [visible, projectId, refreshKnowledgeBases]);
  useEffect(() => { setKnowledgeBasesProject(null); }, [projectId, visible]);

  const send = async (content, mode, webSearch, attachments) => {
    try {
      setLocalError('');
      const resolvedMode = mode === 'GHOSTWRITE' ? 'GHOSTWRITE' : 'CHAT';
      const session = await onEnsureSession();
      if (currentProjectId.current !== projectId || session.projectId !== projectId) return false;
      const targetMeta = await workspace.prepareUnifiedTarget(resolvedMode, session.id);
      if (currentProjectId.current !== projectId) return false;
      const outcome = await onSend(content, 'AUTO', webSearch, attachments, '', null, {
        mode: resolvedMode,
        activeNodeId: targetMeta.activeNodeId,
        activeUnsavedPreview: targetMeta.activeUnsavedPreview,
      });
      if (outcome === false) return false;
      if (!outcome.accepted) {
        if (currentProjectId.current !== projectId) return false;
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
        <button className="workspace-ghost workspace-candidates-trigger" type="button" title="待审变更与候选"
          aria-label={pendingCount ? `待审变更与候选，${pendingCount} 项待处理` : '待审变更与候选'}
          onClick={async () => { setCandidateList(true); await workspace.refresh(); }}>
          <Layers size={16} /><span className="workspace-action-label">变更</span>
          {pendingCount > 0 && <span className="workspace-count">{pendingCount}</span>}
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
          {sessionChangeSets.map((cs) => {
            const items = cs.items || [];
            const status = cs.status || 'PENDING';
            const statusLabel = status === 'PENDING' ? '待审 Diff'
              : status === 'APPLIED' ? (cs.applyMode === 'DIRECT_SNAPSHOT' ? '已直接写入' : '已采纳')
              : status === 'ROLLED_BACK' ? '已撤销' : '已放弃';
            const statusClass = status === 'PENDING' ? 'is-pending' : status === 'APPLIED' ? 'is-applied' : '';
            return <div className="workspace-changeset-card" data-changeset-id={cs.id} key={cs.id}>
              <div className="workspace-changeset-head">
                <strong>{cs.summary || `代笔工作区变更（${items.length} 项）`}</strong>
                <span className={`workspace-changeset-status ${statusClass}`}>{statusLabel}</span>
              </div>
              {items.length > 0 && <div className="workspace-changeset-items">
                {items.slice(0, 6).map((item) => {
                  const nodeTitle = workspace.nodes.find((n) => n.id === item.targetNodeId)?.title || item.title || '节点';
                  const actionName = item.action === 'CREATE_NODE' ? '新建'
                    : item.action === 'PATCH_CONTENT' ? '修改'
                    : item.action === 'WRITE_CONTENT' ? '重写'
                    : item.action === 'RENAME_NODE' ? '重命名'
                    : item.action === 'MOVE_NODE' ? '移动' : '删除';
                  const addCount = item.stats?.addedLines || 0;
                  const delCount = item.stats?.removedLines || 0;
                  return <span className="workspace-changeset-chip" key={item.id}>
                    {actionName} {nodeTitle}
                    {(addCount > 0 || delCount > 0) && ` (+${addCount}/-${delCount})`}
                  </span>;
                })}
                {items.length > 6 && <span className="workspace-changeset-chip">+{items.length - 6} 项</span>}
              </div>}
              <div className="workspace-changeset-actions">
                <button className="workspace-action" type="button" disabled={workspace.busy} onClick={() => setChangeSet(cs)}>查看 Diff</button>
                {status === 'PENDING' && <>
                  <button className="workspace-primary" type="button" disabled={workspace.busy} onClick={() => workspace.mutate(() => workspace.adoptChangeSet(cs)).catch((e) => setLocalError(e.message))}>
                    全部采纳
                  </button>
                  <button className="workspace-ghost" type="button" disabled={workspace.busy} onClick={() => workspace.mutate(() => workspace.discardChangeSet(cs)).catch((e) => setLocalError(e.message))}>
                    放弃
                  </button>
                </>}
                {status === 'APPLIED' && (
                  <button className="workspace-action danger" type="button" disabled={workspace.busy} onClick={() => workspace.mutate(() => workspace.rollbackChangeSet(cs)).catch((e) => setLocalError(e.message))}>
                    撤销本轮修改
                  </button>
                )}
              </div>
            </div>;
          })}
          {sessionCandidates.map((item) => <div className="workspace-candidate-card" data-candidate-id={item.id} key={item.id}>
            <div><strong>{item.operation === 'CREATE_NODE' ? item.title : workspace.nodes.find((node) => node.id === item.targetNodeId)?.title || item.title}</strong>
              <span>{item.status === 'ADOPTED' ? '已采纳' : '待采纳'}</span></div>
            <p>{item.content.slice(0, 150)}{item.content.length > 150 ? '…' : ''}</p>
            <button className="workspace-ghost" type="button" onClick={() => setCandidate(item)}>{item.status === 'ADOPTED' ? '查看修改' : '预览修改'}</button>
          </div>)}
          <div ref={messagesEndRef} />
        </div>
        <InputBox key={projectId} onSend={send} disabled={isSessionLoading || workspace.loading} isLoading={isLoading}
          sessionId={activeSession?.id || ''} assistantMode={assistantMode} onAssistantModeChange={setAssistantMode}
          targetHint={targetHint} />
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
    {changeSet && <ChangeSetDialog key={changeSet.id} changeSet={changeSet} workspace={workspace} onClose={() => setChangeSet(null)} />}
    {candidate && <CandidateDialog key={candidate.id} candidate={candidate} workspace={workspace} onClose={() => setCandidate(null)} />}
    {candidateList && <WorkspaceModal title="代笔变更与候选" wide onClose={() => setCandidateList(false)}>
      {!(workspace.changeSets?.length || workspace.candidates.length) && <p className="workspace-muted">代笔修改工作区或划词建议后，记录会出现在这里。</p>}
      {(workspace.changeSets?.length > 0) && <div className="workspace-candidate-list">
        {workspace.changeSets.map((cs) => <button type="button" data-changeset-id={cs.id} key={cs.id} onClick={() => { setCandidateList(false); setChangeSet(cs); }}>
          <strong>{cs.summary || `代笔变更（${cs.items?.length || 0} 项）`}</strong>
          <span>{cs.status === 'PENDING' ? '待审 Diff' : cs.status === 'APPLIED' ? '已生效（可撤销）' : cs.status === 'ROLLED_BACK' ? '已撤销' : '已放弃'} · {sessions.find((session) => session.id === cs.sourceSessionId)?.title || '历史来源会话'}</span>
        </button>)}
      </div>}
      {workspace.candidates.length > 0 && <div className="workspace-candidate-list">{workspace.candidates.map((item) => <button type="button" data-candidate-id={item.id} key={item.id} onClick={() => { setCandidateList(false); setCandidate(item); }}>
        <strong>{item.title}</strong><span>{item.status === 'ADOPTED' ? '已采纳' : '待采纳'} · {sessions.find((session) => session.id === item.sourceSessionId)?.title || '历史来源会话'}</span>
      </button>)}</div>}
    </WorkspaceModal>}
    {workspace.legacyOpen && <LegacyDialog workspace={workspace} onClose={() => workspace.patch({ legacyOpen: false })} />}
    {exportOpen && <WorkExportDialog project={project} workspace={workspace} sessionId={activeSession?.id} onClose={() => setExportOpen(false)} />}
  </section>;
}
