import { useState, useRef, useEffect } from 'react';
import { MessageSquare, BookOpen, PieChart, PenLine, Wrench, Settings, Plus, Folder, Trash2, Check, ChevronDown } from 'lucide-react';
import '../styles/global.css';

const navItems = [
  { key: 'chat', label: '对话', icon: <MessageSquare size={16} strokeWidth={2} /> },
  { key: 'knowledge-bases', label: '知识库', icon: <BookOpen size={16} strokeWidth={2} /> },
  { key: 'memories', label: '记忆', icon: <PieChart size={16} strokeWidth={2} /> },
  { key: 'writing-skills', label: '风格学习', icon: <PenLine size={16} strokeWidth={2} /> },
  { key: 'skills', label: '技能管理', icon: <Wrench size={16} strokeWidth={2} /> },
  { key: 'settings', label: '设置', icon: <Settings size={16} strokeWidth={2} /> },
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
      <div className="sidebar-header">
        <button className="new-chat-btn" onClick={onNewChat}>
          <Plus size={18} strokeWidth={2} />
          新对话
        </button>
      </div>

      <div className="sidebar-content">
        <div className="project-section">
          <div className="project-section-header">
            <span className="section-label">项目</span>
            <button className="section-action-btn" onClick={onNewProject} title="新建项目">
              <Plus size={14} strokeWidth={2} />
            </button>
          </div>
          <div className="project-list">
            {projects.map((project) => (
              <div
                key={project.id}
                className={`project-item ${activeProject?.id === project.id ? 'active' : ''}`}
                onClick={() => onSelectProject(project)}
                onMouseLeave={() => setConfirmDeleteProjectId(null)}
              >
                <Folder size={16} strokeWidth={2} className="project-icon" />
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
                >
                  {confirmDeleteProjectId === project.id ? (
                    <Check size={12} strokeWidth={2} />
                  ) : (
                    <Trash2 size={12} strokeWidth={2} />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="divider" />

        <div className="session-section">
          <div className="session-section-header">
            <span className="section-label">会话</span>
          </div>
          <div className="session-list">
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
                <MessageSquare size={16} strokeWidth={2} className="session-icon" />
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
                    title="双击重命名"
                  >
                    {session.title}
                  </span>
                )}
                {hoveredSession === session.id && (
                  <button
                    className="session-delete-btn"
                    onClick={(e) => handleDeleteClick(e, session)}
                    title={confirmDeleteId === session.id ? '再次点击确认删除' : '删除对话'}
                  >
                    {confirmDeleteId === session.id ? (
                      <Check size={14} strokeWidth={2} />
                    ) : (
                      <Trash2 size={14} strokeWidth={2} />
                    )}
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
          <span className="user-name">用户</span>
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={`user-menu-arrow ${isUserMenuOpen ? 'open' : ''}`}
          />
        </div>
        {isUserMenuOpen && (
          <div className="user-dropdown-menu">
            {navItems.map((item) => (
              <button
                key={item.key}
                className={`user-dropdown-item ${view === item.key ? 'active' : ''}`}
                onClick={() => {
                  onNavigate(item.key);
                  setIsUserMenuOpen(false);
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
