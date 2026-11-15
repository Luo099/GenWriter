import { useState, useRef, useEffect } from 'react';
import '../styles/global.css';

const navItems = [
  { key: 'chat', label: '对话', icon: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
  )},
  { key: 'knowledge-bases', label: '知识库', icon: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
    </svg>
  )},
  { key: 'memories', label: '长期记忆', icon: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 8 0v-1a3 3 0 0 0 0-6V7a4 4 0 0 0-4-4z"></path>
      <path d="M12 3v18"></path>
    </svg>
  )},
  { key: 'writing-skills', label: '风格学习', icon: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
      <path d="M2 2l7.586 7.586"></path>
      <circle cx="11" cy="11" r="2"></circle>
    </svg>
  )},
  { key: 'skills', label: '技能', icon: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
    </svg>
  )},
  { key: 'settings', label: '系统设置', icon: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.36.44.65.82.79H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
  )},
];

const Sidebar = ({
  projects,
  activeProject,
  sessions,
  activeSession,
  view,
  onSelectProject,
  onNewProject,
  onDeleteProject,
  onUpdateProject,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onUpdateSession,
  onNavigate,
}) => {
  const [hoveredSession, setHoveredSession] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  // 项目编辑状态
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const projectInputRef = useRef(null);

  // 会话编辑状态
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState('');
  const sessionInputRef = useRef(null);

  // 项目编辑聚焦
  useEffect(() => {
    if (editingProjectId && projectInputRef.current) {
      projectInputRef.current.focus();
      projectInputRef.current.select();
    }
  }, [editingProjectId]);

  // 会话编辑聚焦
  useEffect(() => {
    if (editingSessionId && sessionInputRef.current) {
      sessionInputRef.current.focus();
      sessionInputRef.current.select();
    }
  }, [editingSessionId]);

  // 点击外部关闭用户菜单
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDeleteClick = (e, session) => {
    e.stopPropagation();
    if (confirmDeleteId === session.id) {
      onDeleteSession(session);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(session.id);
    }
  };

  const handleDeleteProjectClick = (e, project) => {
    e.stopPropagation();
    if (confirmDeleteProjectId === project.id) {
      onDeleteProject(project);
      setConfirmDeleteProjectId(null);
    } else {
      setConfirmDeleteProjectId(project.id);
    }
  };

  // ---------- 项目重命名 ----------
  const startEditingProject = (e, project) => {
    e.stopPropagation();
    setEditingProjectId(project.id);
    setEditingProjectName(project.name);
  };

  const commitProjectEdit = () => {
    if (!editingProjectId) return;
    const trimmed = editingProjectName.trim();
    if (trimmed) {
      const project = projects.find((p) => p.id === editingProjectId);
      if (project && project.name !== trimmed) {
        onUpdateProject({ ...project, name: trimmed });
      }
    }
    setEditingProjectId(null);
    setEditingProjectName('');
  };

  const handleProjectKeyDown = (e) => {
    if (e.key === 'Enter') {
      commitProjectEdit();
    } else if (e.key === 'Escape') {
      setEditingProjectId(null);
      setEditingProjectName('');
    }
  };

  // ---------- 会话重命名 ----------
  const startEditingSession = (e, session) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingSessionTitle(session.title);
  };

  const commitSessionEdit = () => {
    if (!editingSessionId) return;
    const trimmed = editingSessionTitle.trim();
    if (trimmed) {
      const session = sessions.find((s) => s.id === editingSessionId);
      if (session && session.title !== trimmed) {
        onUpdateSession({ ...session, title: trimmed });
      }
    }
    setEditingSessionId(null);
    setEditingSessionTitle('');
  };

  const handleSessionKeyDown = (e) => {
    if (e.key === 'Enter') {
      commitSessionEdit();
    } else if (e.key === 'Escape') {
      setEditingSessionId(null);
      setEditingSessionTitle('');
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M12 2.5 21 7l-9 4.5L3 7l9-4.5z" />
            <path d="M3 12l9 4.5L21 12" />
            <path d="M3 17l9 4.5L21 17" />
          </svg>
        </span>
        <span className="brand-text">
          <strong>GenWriter</strong>
          <small>Agent 写作工作台</small>
        </span>
      </div>

      <nav className="sidebar-nav" aria-label="主导航">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`sidebar-nav-item${view === item.key ? ' active' : ''}`}
            onClick={() => onNavigate(item.key)}
            aria-current={view === item.key ? 'page' : undefined}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-header">
        <button className="new-chat-btn" onClick={onNewChat} type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          新对话
        </button>
      </div>

      <div className="sidebar-content">
        <div className="project-section">
          <div className="project-section-header">
            <span className="section-label">项目</span>
            <button className="section-action-btn" onClick={onNewProject} title="新建项目" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
          <div className="project-list">
            {projects.length === 0 && (
              <p className="sidebar-empty-hint">还没有项目，点击右上角 + 新建</p>
            )}
            {projects.map((project) => (
              <div
                key={project.id}
                className={`project-item ${activeProject?.id === project.id ? 'active' : ''}`}
                onClick={() => onSelectProject(project)}
                onMouseLeave={() => setConfirmDeleteProjectId(null)}
              >
                <svg className="project-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                {editingProjectId === project.id ? (
                  <input
                    ref={projectInputRef}
                    className="sidebar-edit-input"
                    value={editingProjectName}
                    onChange={(e) => setEditingProjectName(e.target.value)}
                    onBlur={commitProjectEdit}
                    onKeyDown={handleProjectKeyDown}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="project-name"
                    onDoubleClick={(e) => startEditingProject(e, project)}
                    title="双击重命名"
                  >
                    {project.name}
                  </span>
                )}
                <span className="project-session-count">{project.sessionCount || 0}</span>
                <button
                  className="project-delete-btn"
                  onClick={(e) => handleDeleteProjectClick(e, project)}
                  title={confirmDeleteProjectId === project.id ? '再次点击确认删除' : '删除项目'}
                  type="button"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {confirmDeleteProjectId === project.id ? (
                      <polyline points="20 6 9 17 4 12"></polyline>
                    ) : (
                      <>
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </>
                    )}
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="divider" />

        <div className="session-section">
          <div className="session-section-header">
            <span className="section-label">会话</span>
            <span className="section-count">{sessions.length || 0}</span>
          </div>
          <div className="session-list">
            {sessions.length === 0 && (
              <div className="sidebar-empty">
                <p>这个项目下还没有会话</p>
                <button type="button" onClick={onNewChat}>新建一个对话</button>
              </div>
            )}
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`session-item ${activeSession?.id === session.id ? 'active' : ''}`}
                onClick={() => onSelectSession(session)}
                onMouseEnter={() => setHoveredSession(session.id)}
                onMouseLeave={() => {
                  setHoveredSession(null);
                  setConfirmDeleteId(null);
                }}
              >
                <span className="session-dot" aria-hidden="true" />
                {editingSessionId === session.id ? (
                  <input
                    ref={sessionInputRef}
                    className="sidebar-edit-input"
                    value={editingSessionTitle}
                    onChange={(e) => setEditingSessionTitle(e.target.value)}
                    onBlur={commitSessionEdit}
                    onKeyDown={handleSessionKeyDown}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="session-title"
                    onDoubleClick={(e) => startEditingSession(e, session)}
                    title={session.title}
                  >
                    {session.title}
                  </span>
                )}
                {hoveredSession === session.id && (
                  <button
                    className="session-delete-btn"
                    onClick={(e) => handleDeleteClick(e, session)}
                    title={confirmDeleteId === session.id ? '再次点击确认删除' : '删除对话'}
                    type="button"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {confirmDeleteId === session.id ? (
                        <polyline points="20 6 9 17 4 12"></polyline>
                      ) : (
                        <>
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </>
                      )}
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sidebar-footer" ref={userMenuRef}>
        <div
          className="user-info"
          onClick={() => setIsUserMenuOpen((prev) => !prev)}
        >
          <div className="user-avatar">U</div>
          <div className="user-meta">
            <span className="user-name">用户</span>
            <span className="user-plan">本地工作区</span>
          </div>
          <svg
            className={`user-menu-arrow ${isUserMenuOpen ? 'open' : ''}`}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
        {isUserMenuOpen && (
          <div className="user-dropdown-menu">
            <button
              className={`user-dropdown-item ${view === 'settings' ? 'active' : ''}`}
              onClick={() => {
                onNavigate('settings');
                setIsUserMenuOpen(false);
              }}
              type="button"
            >
              {navItems[navItems.length - 1].icon}
              系统与模型设置
            </button>
            <div className="user-dropdown-meta">GenWriter · Spring Boot + React</div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
