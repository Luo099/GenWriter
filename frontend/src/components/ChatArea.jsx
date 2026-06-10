import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';
import InputBox from './InputBox';
import WelcomeScreen from './WelcomeScreen';
import WritingWorkbench from './WritingWorkbench';
import '../styles/global.css';

const WORKBENCH_WIDTH_KEY = 'genwriter_workbench_width';
const WORKBENCH_COLLAPSED_KEY = 'genwriter_workbench_collapsed';
const MIN_WORKBENCH_WIDTH = 320;
const MAX_WORKBENCH_WIDTH = 680;
const DEFAULT_WORKBENCH_WIDTH = 460;
const NAVIGATOR_PREVIEW_LENGTH = 42;

const clampWorkbenchWidth = (value) =>
  Math.min(MAX_WORKBENCH_WIDTH, Math.max(MIN_WORKBENCH_WIDTH, value));

const readSavedWorkbenchWidth = () => {
  if (typeof window === 'undefined') return DEFAULT_WORKBENCH_WIDTH;
  const saved = Number(window.localStorage.getItem(WORKBENCH_WIDTH_KEY));
  return Number.isFinite(saved) ? clampWorkbenchWidth(saved) : DEFAULT_WORKBENCH_WIDTH;
};

const readSavedCollapsed = () => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(WORKBENCH_COLLAPSED_KEY) === 'true';
};

const getMessagePreview = (message) => {
  const content = typeof message?.content === 'string' ? message.content : '';
  const preview = content
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[`*_>#~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (preview) {
    return preview.length > NAVIGATOR_PREVIEW_LENGTH
      ? `${preview.slice(0, NAVIGATOR_PREVIEW_LENGTH)}...`
      : preview;
  }

  return message?.attachments?.length > 0 ? '附件消息' : '空消息';
};

const ChatArea = ({
  messages,
  onSend,
  onSuggestionClick,
  onExport,
  isLoading,
  hasContentStarted,
  isSessionLoading,
  selectedKbId = '',
  sessionId = '',
  documentRefresh,
}) => {
  const messagesEndRef = useRef(null);
  const messagesScrollRef = useRef(null);
  const messageRefs = useRef([]);
  const [workbenchWidth, setWorkbenchWidth] = useState(readSavedWorkbenchWidth);
  const [workbenchCollapsed, setWorkbenchCollapsed] = useState(readSavedCollapsed);
  const [conversationMarks, setConversationMarks] = useState([]);
  const [activeNavigatorId, setActiveNavigatorId] = useState(null);

  const userNavigationItems = useMemo(
    () => messages.reduce((items, message, index) => {
      if (message.role !== 'user') return items;
      items.push({
        id: `message-${message.id || index}`,
        messageIndex: index,
        preview: getMessagePreview(message),
        turnNumber: items.length + 1,
      });
      return items;
    }, []),
    [messages]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    messageRefs.current = messageRefs.current.slice(0, messages.length);
  }, [messages.length]);

  const measureNavigatorMarks = useCallback(() => {
    const container = messagesScrollRef.current;
    if (!container || userNavigationItems.length < 2 || container.scrollHeight <= container.clientHeight + 8) {
      setConversationMarks([]);
      setActiveNavigatorId(null);
      return;
    }

    const contentHeight = Math.max(container.scrollHeight, 1);
    const nextMarks = userNavigationItems.map((item) => {
      const node = messageRefs.current[item.messageIndex];
      const rawTopPercent = node ? (node.offsetTop / contentHeight) * 100 : 0;

      return {
        ...item,
        topPercent: Math.min(96, Math.max(4, rawTopPercent)),
      };
    });

    const minGapPercent = Math.min(3, 92 / Math.max(nextMarks.length - 1, 1));
    const lastMarkIndex = nextMarks.length - 1;
    for (let index = 1; index < nextMarks.length; index += 1) {
      nextMarks[index].topPercent = Math.max(
        nextMarks[index].topPercent,
        nextMarks[index - 1].topPercent + minGapPercent
      );
    }
    for (let index = 0; index < nextMarks.length; index += 1) {
      nextMarks[index].topPercent = Math.min(
        nextMarks[index].topPercent,
        96 - (lastMarkIndex - index) * minGapPercent
      );
    }
    for (let index = nextMarks.length - 2; index >= 0; index -= 1) {
      nextMarks[index].topPercent = Math.min(
        nextMarks[index].topPercent,
        nextMarks[index + 1].topPercent - minGapPercent
      );
    }

    setConversationMarks(nextMarks.map((item) => ({
      ...item,
      topPercent: Math.min(96, Math.max(4, item.topPercent)),
    })));
  }, [userNavigationItems]);

  const updateActiveNavigator = useCallback(() => {
    const container = messagesScrollRef.current;
    if (!container || conversationMarks.length === 0) return;

    const currentTop = container.scrollTop + Math.max(
      0,
      Math.min(container.clientHeight * 0.75, container.clientHeight - 40)
    );
    let activeItem = conversationMarks[0];

    for (const item of conversationMarks) {
      const node = messageRefs.current[item.messageIndex];
      if (node && node.offsetTop <= currentTop) {
        activeItem = item;
      }
    }

    setActiveNavigatorId((current) => (
      current === activeItem?.id ? current : activeItem?.id
    ));
  }, [conversationMarks]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const frame = window.requestAnimationFrame(measureNavigatorMarks);
    let resizeObserver;

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measureNavigatorMarks);
      if (messagesScrollRef.current) {
        resizeObserver.observe(messagesScrollRef.current);
      }
      messageRefs.current.forEach((node) => {
        if (node) resizeObserver.observe(node);
      });
    }

    window.addEventListener('resize', measureNavigatorMarks);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', measureNavigatorMarks);
      resizeObserver?.disconnect();
    };
  }, [measureNavigatorMarks, messages.length]);

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container || conversationMarks.length === 0) return undefined;

    updateActiveNavigator();
    container.addEventListener('scroll', updateActiveNavigator, { passive: true });

    return () => {
      container.removeEventListener('scroll', updateActiveNavigator);
    };
  }, [conversationMarks, updateActiveNavigator]);

  const handleNavigatorJump = useCallback((item) => {
    const container = messagesScrollRef.current;
    const node = messageRefs.current[item.messageIndex];
    if (!container || !node) return;

    const maxScroll = Math.max(container.scrollHeight - container.clientHeight, 0);
    const targetScroll = Math.min(Math.max(node.offsetTop - 18, 0), maxScroll);
    container.scrollTo({ top: targetScroll, behavior: 'smooth' });
    setActiveNavigatorId(item.id);
  }, []);

  const handleWorkbenchCollapse = useCallback((collapsed) => {
    setWorkbenchCollapsed(collapsed);
    window.localStorage.setItem(WORKBENCH_COLLAPSED_KEY, String(collapsed));
  }, []);

  const handleResizeStart = useCallback((event) => {
    event.preventDefault();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent) => {
      const nextWidth = clampWorkbenchWidth(window.innerWidth - moveEvent.clientX);
      setWorkbenchWidth(nextWidth);
      window.localStorage.setItem(WORKBENCH_WIDTH_KEY, String(nextWidth));
    };

    const handleEnd = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  }, []);

  const handleResetWidth = useCallback(() => {
    setWorkbenchWidth(DEFAULT_WORKBENCH_WIDTH);
    window.localStorage.setItem(WORKBENCH_WIDTH_KEY, String(DEFAULT_WORKBENCH_WIDTH));
  }, []);

  return (
    <div
      className={`chat-area${workbenchCollapsed ? ' workbench-is-collapsed' : ''}`}
      style={{ '--workbench-width': `${workbenchWidth}px` }}
    >
      <div className="chat-conversation">
        {messages.length === 0 && !isSessionLoading ? (
          <WelcomeScreen onSuggestionClick={onSuggestionClick} />
        ) : (
          <div className="messages-scroll-shell">
            <div className="messages-container" ref={messagesScrollRef}>
              {isSessionLoading && messages.length === 0 && (
                <div className="messages-loading">
                  <div className="loading-spinner"></div>
                  <p>加载消息中...</p>
                </div>
              )}
              {messages.map((message, index) => (
                <div
                  className="message-anchor"
                  key={index}
                  ref={(node) => {
                    messageRefs.current[index] = node;
                  }}
                >
                  <MessageBubble message={message} onExport={onExport} />
                </div>
              ))}
              {isLoading && !hasContentStarted && (
                <div className="message-bubble assistant">
                  <div className="message-avatar">G</div>
                  <div className="message-content">
                    <div className="thinking-status">
                      <span className="thinking-text">思考中</span>
                      <div className="thinking-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            {conversationMarks.length > 0 && (
              <nav className="conversation-navigator" aria-label="用户消息快速定位">
                <div className="conversation-navigator-track" aria-hidden="true" />
                {conversationMarks.map((item) => (
                  <button
                    className={`conversation-navigator-node${activeNavigatorId === item.id ? ' active' : ''}`}
                    key={item.id}
                    type="button"
                    style={{ top: `${item.topPercent}%` }}
                    title={item.preview}
                    aria-label={`跳到第 ${item.turnNumber} 条用户消息：${item.preview}`}
                    onClick={() => handleNavigatorJump(item)}
                  >
                    <span className="conversation-navigator-dot" aria-hidden="true" />
                    <span className="conversation-navigator-preview">
                      <span className="conversation-navigator-preview-kicker">用户 {item.turnNumber}</span>
                      <span className="conversation-navigator-preview-text">{item.preview}</span>
                    </span>
                  </button>
                ))}
              </nav>
            )}
          </div>
        )}
        <InputBox
          onSend={onSend}
          disabled={isSessionLoading}
          isLoading={isLoading}
          kbId={selectedKbId}
          sessionId={sessionId}
        />
      </div>
      {!workbenchCollapsed && (
        <button
          className="workbench-resizer"
          type="button"
          onPointerDown={handleResizeStart}
          onDoubleClick={handleResetWidth}
          title="拖动调整工作台宽度，双击恢复默认"
          aria-label="调整工作台宽度"
        />
      )}
      <WritingWorkbench
        sessionId={sessionId}
        isLoading={isLoading}
        selectedKbId={selectedKbId}
        documentRefresh={documentRefresh}
        onIterate={onSend}
        collapsed={workbenchCollapsed}
        onCollapse={() => handleWorkbenchCollapse(true)}
        onExpand={() => handleWorkbenchCollapse(false)}
      />
    </div>
  );
};

export default ChatArea;
