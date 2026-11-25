import { useEffect, useRef, useState } from 'react';
import { Activity, BookOpenText, Boxes, ChevronDown, Feather, Folder, LibraryBig, MoreHorizontal,
  PanelLeftClose, PanelLeftOpen, Plus, Settings2, SlidersHorizontal, Sparkles } from 'lucide-react';
import ContentTree from './ContentTree';
import { WorkspaceModal } from './WorkspaceDialogs';

const managementItems = [
  ['knowledge-bases', '知识库', LibraryBig], ['memories', '记忆', Sparkles],
  ['writing-skills', '风格学习', Feather], ['skills', '技能管理', Boxes], ['settings', '设置', Settings2],
  ['observability', 'AI Ops', Activity],
];

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'genwriter-sidebar-collapsed';
const SIDEBAR_WIDTH_STORAGE_KEY = 'genwriter-sidebar-width';
const SIDEBAR_COLLAPSED_WIDTH = 60;
const SIDEBAR_MIN_EXPANDED_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_NARROW_QUERY = '(max-width: 760px)';

const readSidebarWidth = () => {
  try {
    const savedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(savedWidth) && savedWidth >= SIDEBAR_MIN_EXPANDED_WIDTH
      ? Math.min(savedWidth, SIDEBAR_MAX_WIDTH)
      : 224;
  } catch {
    return 224;
  }
};

export default function Sidebar({
  projects, activeProject, view, onSelectProject, onNewProject, onDeleteProject, onUpdateProject,
  onNavigate, workspace, onSelectNode, onLegacy,
}) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try { return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'; }
    catch { return false; }
  });
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(SIDEBAR_NARROW_QUERY).matches);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [projectToDelete, setProjectToDelete] = useState(null);
  const projectInputRef = useRef(null);
  const toggleRef = useRef(null);
  const resizeStateRef = useRef(null);
  const collapsed = isNarrow ? !mobileOpen : isCollapsed;

  useEffect(() => {
    const narrow = window.matchMedia(SIDEBAR_NARROW_QUERY);
    const update = () => { setIsNarrow(narrow.matches); setMobileOpen(false); };
    narrow.addEventListener('change', update);
    return () => narrow.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (editingProjectId) {
      projectInputRef.current?.focus();
      projectInputRef.current?.select();
    }
  }, [editingProjectId]);

  const setSidebarCollapsed = (next) => {
    setIsCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next)); }
    catch { /* Storage is optional. */ }
  };

  const persistSidebarWidth = (width) => {
    try { window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width))); }
    catch { /* Storage is optional. */ }
  };

  const handleResizePointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth,
      lastExpandedWidth: sidebarWidth,
      collapsed: isCollapsed,
    };
    setIsResizing(true);
  };

  const handleResizePointerMove = (event) => {
    const drag = resizeStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width = Math.min(SIDEBAR_MAX_WIDTH, drag.startWidth + event.clientX - drag.startX);
    const nextCollapsed = width < SIDEBAR_MIN_EXPANDED_WIDTH;
    if (nextCollapsed !== drag.collapsed) {
      drag.collapsed = nextCollapsed;
      setSidebarCollapsed(nextCollapsed);
    }
    if (!nextCollapsed) {
      drag.lastExpandedWidth = width;
      setSidebarWidth(width);
    }
  };

  const handleResizePointerEnd = (event) => {
    const drag = resizeStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    persistSidebarWidth(drag.lastExpandedWidth);
    resizeStateRef.current = null;
    setIsResizing(false);
  };

  const handleResizeKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const width = isCollapsed && event.key === 'ArrowRight' ? SIDEBAR_MIN_EXPANDED_WIDTH
      : sidebarWidth + (event.key === 'ArrowRight' ? 16 : -16);
    if (width < SIDEBAR_MIN_EXPANDED_WIDTH) {
      setSidebarCollapsed(true);
      return;
    }
    const bounded = Math.min(width, SIDEBAR_MAX_WIDTH);
    setSidebarWidth(bounded);
    setSidebarCollapsed(false);
    persistSidebarWidth(bounded);
  };

  const closeMobile = () => {
    if (!mobileOpen) return;
    setMobileOpen(false);
    toggleRef.current?.focus();
  };

  const commitProjectEdit = () => {
    const project = projects.find((item) => item.id === editingProjectId);
    const name = editingProjectName.trim();
    if (project && name && project.name !== name) onUpdateProject({ ...project, name });
    setEditingProjectId(null);
  };

  return <>
    {isNarrow && mobileOpen && <><div className="sidebar-mobile-spacer" /><div className="sidebar-scrim" aria-hidden="true" onClick={closeMobile} /></>}
    <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}${isResizing ? ' is-resizing' : ''}${isNarrow && mobileOpen ? ' is-mobile-open' : ''}`}
      style={{ '--sidebar-current-width': `${sidebarWidth}px` }} aria-label="GenWriter 导航"
      onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) closeMobile(); }}>
      <div className="sidebar-header">
        {!collapsed && <div className="sidebar-brand"><span>GenWriter</span></div>}
        <button className="sidebar-collapse-btn" type="button" ref={toggleRef}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed}
          onClick={() => isNarrow ? setMobileOpen(!mobileOpen) : setSidebarCollapsed(!isCollapsed)}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
      <nav className="sidebar-workspace-nav" aria-label="主导航">
        <button className="sidebar-workspace-link" type="button" aria-label="工作区" title="工作区" aria-current={view === 'chat' ? 'page' : undefined}
          onClick={() => { onNavigate('chat'); closeMobile(); }}>
          <BookOpenText size={17} /><span>工作区</span>
        </button>
      </nav>
      {!collapsed && <div className="sidebar-content">
        <section className="project-section" aria-label="作品列表">
          <div className="project-section-header">
            <span className="section-label">作品</span>
            <button className="section-action-btn" type="button" aria-label="新建作品" title="新建作品"
              onClick={() => { onNavigate('chat'); onNewProject(); closeMobile(); }}><Plus size={16} /></button>
          </div>
          <div className="project-list">
            {projects.map((project) => <div className={`project-item${project.id === activeProject?.id ? ' active' : ''}`} key={project.id}>
              {editingProjectId === project.id ? <input ref={projectInputRef} className="sidebar-edit-input" aria-label="作品名称"
                value={editingProjectName} onChange={(event) => setEditingProjectName(event.target.value)} onBlur={commitProjectEdit}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === 'Enter') commitProjectEdit();
                  else if (event.key === 'Escape') { event.stopPropagation(); setEditingProjectId(null); }
                }} /> : <button className="project-link" type="button" title={project.name}
                aria-current={project.id === activeProject?.id ? 'true' : undefined}
                onClick={() => { if (project.id !== activeProject?.id) onSelectProject(project); onNavigate('chat'); closeMobile(); }}>
                <Folder size={15} className="project-icon" /><span className="project-name">{project.name}</span>
              </button>}
              <details className="tree-menu sidebar-project-menu" onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
              }} onKeyDown={(event) => {
                if (event.key !== 'Escape' || !event.currentTarget.open) return;
                event.stopPropagation();
                event.currentTarget.open = false;
                event.currentTarget.querySelector('summary')?.focus();
              }}>
                <summary aria-label={`${project.name}的作品操作`} title="作品操作"><MoreHorizontal size={15} /></summary>
                <div className="tree-menu-items">
                  <button type="button" onClick={(event) => {
                    event.currentTarget.closest('details').open = false;
                    setEditingProjectName(project.name);
                    setEditingProjectId(project.id);
                  }}>重命名作品</button>
                  <button className="danger" type="button" onClick={(event) => {
                    const menu = event.currentTarget.closest('details');
                    menu.open = false;
                    menu.querySelector('summary')?.focus();
                    setProjectToDelete(project);
                  }}>删除作品…</button>
                </div>
              </details>
            </div>)}
          </div>
        </section>
        {workspace && activeProject && <ContentTree workspace={workspace}
          onSelect={(nodeId) => { onSelectNode(nodeId); closeMobile(); }}
          onLegacy={() => { onLegacy(); closeMobile(); }} />}
      </div>}
      <footer className="sidebar-footer">
        <details className="sidebar-management" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }} onKeyDown={(event) => {
          if (event.key !== 'Escape' || !event.currentTarget.open) return;
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }}>
          <summary className={view === 'chat' ? '' : 'active'} aria-label="管理" title="管理">
            <SlidersHorizontal size={17} /><span>管理</span><ChevronDown className="sidebar-management-chevron" size={14} />
          </summary>
          <nav className="sidebar-management-links" aria-label="管理页面">
            {managementItems.map((item) => {
              const [key, label, Icon] = item;
              return <button key={key} type="button" aria-current={view === key ? 'page' : undefined}
                onClick={(event) => {
                  const menu = event.currentTarget.closest('details');
                  menu.open = false;
                  menu.querySelector('summary')?.focus();
                  onNavigate(key);
                  closeMobile();
                }}><Icon size={16} />{label}</button>;
            })}
          </nav>
        </details>
      </footer>
      {!isNarrow && <div className="sidebar-resize-handle" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical"
        aria-valuemin={SIDEBAR_COLLAPSED_WIDTH} aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={collapsed ? SIDEBAR_COLLAPSED_WIDTH : Math.round(sidebarWidth)} tabIndex={0}
        onPointerDown={handleResizePointerDown} onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd} onPointerCancel={handleResizePointerEnd} onKeyDown={handleResizeKeyDown} />}
    </aside>
    {projectToDelete && <WorkspaceModal title="删除作品" onClose={() => setProjectToDelete(null)} footer={<>
      <button type="button" onClick={() => setProjectToDelete(null)}>取消</button>
      <button type="button" className="workspace-primary" onClick={() => { onDeleteProject(projectToDelete); setProjectToDelete(null); }}>确认删除</button>
    </>}>
      <p>确认删除「{projectToDelete.name}」和此作品的正文、会话？</p>
    </WorkspaceModal>}
  </>;
}
