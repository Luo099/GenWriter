/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mark } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { DOMSerializer } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Bold, Code, Eye, Highlighter, Italic, Link as LinkIcon, List, ListOrdered, Minus,
  MoreHorizontal, Quote, Redo2, SlidersHorizontal, Table2, Undo2 } from 'lucide-react';
import SelectField from './SelectField';
import { htmlToMarkdown, markdownToHtml } from '../utils/markdownEditor';

const contextWindow = 1500;
const selectionPluginKey = 'work-selection-actions';
const headingOptions = [
  { value: 0, label: '正文' }, { value: 1, label: '一级标题' },
  { value: 2, label: '二级标题' }, { value: 3, label: '三级标题' },
];
const selectionActions = [
  ['POLISH_SELECTION', '润色'], ['REWRITE_SELECTION', '重写'], ['CONTINUE_AFTER_SELECTION', '续写'],
];
const Highlight = Mark.create({
  name: 'highlight',
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: () => ['mark', 0],
});

const ToolbarButton = ({ pressed, disabled, title, tabIndex, onClick, children, ...attributes }) => (
  <button type="button" className="editor-toolbar-button" title={title} aria-label={title}
    aria-pressed={pressed} disabled={disabled} tabIndex={tabIndex} data-editor-control
    onMouseDown={(event) => event.preventDefault()} onClick={onClick} {...attributes}>
    {children}
  </button>
);

const buildSelectionSnapshot = (editor) => {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;

  const doc = editor.state.doc;
  const selectedText = doc.textBetween(from, to, '\n').trim();
  if (!selectedText) return null;

  const container = document.createElement('div');
  container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(doc.slice(from, to).content));
  return {
    from, to, selectedText,
    selectedMarkdown: htmlToMarkdown(container.innerHTML) || selectedText,
    beforeText: doc.textBetween(Math.max(0, from - contextWindow), from, '\n'),
    afterText: doc.textBetween(to, Math.min(doc.content.size, to + contextWindow), '\n'),
    fullTextLength: doc.textBetween(0, doc.content.size, '\n').length,
  };
};

export default function RichMarkdownEditor({
  value, documentKey, disabled = false, placeholder = '在这里编辑当前文稿...',
  onChange, onSelectionSnapshot, onEditorReady, onSelectionAction, selectionLoading,
  toolbarOpen = true, children,
}) {
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceValue, setSourceValue] = useState(value || '');
  const [toolbarIndex, setToolbarIndex] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [instructionOpen, setInstructionOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const menuRef = useRef(null);
  const appliedValueRef = useRef(value || '');
  const currentDocumentKeyRef = useRef(documentKey);
  const documentStatesRef = useRef(new Map());
  const onChangeRef = useRef(onChange);
  const onSelectionSnapshotRef = useRef(onSelectionSnapshot);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onSelectionSnapshotRef.current = onSelectionSnapshot; }, [onSelectionSnapshot]);

  const extensions = useMemo(() => [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
    Link.configure({ autolink: true, openOnClick: false, linkOnPaste: true, defaultProtocol: 'https' }),
    Placeholder.configure({ placeholder }),
    Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
    TaskList, TaskItem.configure({ nested: true }),
    Highlight,
  ], [placeholder]);

  const editor = useEditor({
    extensions,
    content: markdownToHtml(value || ''),
    editable: !disabled,
    editorProps: {
      attributes: { class: 'editor-prose', 'aria-label': 'Markdown 正文' },
    },
    onUpdate: ({ editor: currentEditor, transaction }) => {
      if (!transaction.docChanged) return;
      const nextMarkdown = htmlToMarkdown(currentEditor.getHTML());
      appliedValueRef.current = nextMarkdown;
      setSourceValue(nextMarkdown);
      onChangeRef.current?.(nextMarkdown);
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      if (onSelectionSnapshotRef.current) onSelectionSnapshotRef.current(buildSelectionSnapshot(currentEditor));
    },
  }, [extensions]);

  const formats = useEditorState({
    editor,
    selector: ({ editor }) => ({
      heading: editor?.getAttributes('heading').level || 0,
      bold: editor?.isActive('bold'),
      italic: editor?.isActive('italic'),
      blockquote: editor?.isActive('blockquote'),
      bulletList: editor?.isActive('bulletList'),
      orderedList: editor?.isActive('orderedList'),
      highlight: editor?.isActive('highlight'),
      code: editor?.isActive('code'),
    }),
  });

  useEffect(() => { editor?.setEditable(!disabled, false); }, [disabled, editor]);
  useEffect(() => { if (editor) onEditorReady?.(editor); }, [editor, onEditorReady]);
  useEffect(() => { if (!toolbarOpen || disabled) setMoreOpen(false); }, [disabled, toolbarOpen]);

  useEffect(() => {
    const nextValue = value || '';
    setSourceValue(nextValue);
    const changedDocument = currentDocumentKeyRef.current !== documentKey;
    if (!editor || (!changedDocument && nextValue === appliedValueRef.current)) return;
    if (changedDocument && currentDocumentKeyRef.current != null) {
      documentStatesRef.current.set(currentDocumentKeyRef.current, { value: appliedValueRef.current, state: editor.state });
    }
    const cached = documentStatesRef.current.get(documentKey);
    if (changedDocument && cached?.value === nextValue) {
      // Reuse the current plugin set even if a contextual menu mounted after this state was cached.
      editor.view.updateState(cached.state.reconfigure({ plugins: editor.state.plugins }));
    } else {
      editor.chain().setMeta('addToHistory', false).setContent(markdownToHtml(nextValue), { emitUpdate: false }).run();
      const synced = editor.state;
      editor.view.updateState(EditorState.create({ schema: synced.schema, doc: synced.doc, plugins: synced.plugins }));
    }
    // Direct ProseMirror state replacement bypasses the transaction event used by toolbar subscriptions.
    editor.emit('transaction', { editor, transaction: editor.state.tr, appendedTransactions: [] });
    appliedValueRef.current = nextValue;
    currentDocumentKeyRef.current = documentKey;
    if (onSelectionSnapshotRef.current) onSelectionSnapshotRef.current(buildSelectionSnapshot(editor));
  }, [documentKey, editor, value]);

  const runCommand = (callback) => {
    if (editor && !disabled) callback(editor.chain().focus()).run();
  };

  const setLink = () => {
    if (!editor || disabled) return;
    const url = window.prompt('输入链接地址', editor.getAttributes('link').href || 'https://');
    if (url === null) return;
    runCommand((chain) => url.trim() ? chain.extendMarkRange('link').setLink({ href: url.trim() }) : chain.extendMarkRange('link').unsetLink());
  };

  const handleToolbarFocus = (event) => {
    const controls = [...event.currentTarget.querySelectorAll('[data-editor-control], .select-field-trigger')];
    const index = controls.indexOf(event.target);
    if (index >= 0) setToolbarIndex(index);
  };

  const handleToolbarKeyDown = (event) => {
    if (event.defaultPrevented || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('[data-editor-control]:not(:disabled), .select-field-trigger:not(:disabled)')];
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  const runSelection = (mode) => {
    if (!editor || selectionLoading) return;
    const snapshot = buildSelectionSnapshot(editor);
    if (!snapshot) return;
    onSelectionAction(mode, instruction.trim(), snapshot);
    setInstructionOpen(false);
    setInstruction('');
  };

  const shouldShowSelection = useCallback(({ view, state, from, to }) =>
    (view.hasFocus() || menuRef.current?.contains(document.activeElement)) &&
    !state.selection.empty && Boolean(state.doc.textBetween(from, to, ' ').trim()), []);

  const selectionOptions = useMemo(() => ({
    strategy: 'fixed', placement: 'top', offset: 9, shift: { padding: 8 }, flip: { padding: 8 },
    hide: { strategy: 'referenceHidden' },
    onHide: () => { setInstructionOpen(false); setInstruction(''); },
  }), []);

  const showSelectionMenu = Boolean(editor && onSelectionAction && !disabled && !sourceMode);
  useEffect(() => {
    if (showSelectionMenu) editor.commands.setMeta(selectionPluginKey, 'updatePosition');
  }, [editor, instructionOpen, showSelectionMenu]);

  const formattingDisabled = !editor || disabled;
  const overflowActions = [
    [Highlighter, '高亮', formats?.highlight, () => runCommand((chain) => chain.toggleMark('highlight'))],
    [ListOrdered, '编号列表', formats?.orderedList, () => runCommand((chain) => chain.toggleOrderedList())],
    [Minus, '分割线', undefined, () => runCommand((chain) => chain.setHorizontalRule())],
    [Code, '行内代码', formats?.code, () => runCommand((chain) => chain.toggleCode())],
    [LinkIcon, '链接', undefined, setLink],
    [Table2, '表格', undefined, () => runCommand((chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))],
    [Code, 'Markdown 源码', undefined, () => setSourceMode(true)],
  ];

  return <div className={disabled ? 'rich-markdown-editor disabled' : 'rich-markdown-editor'}>
    {sourceMode ? <div className="editor-toolbar" role="toolbar" aria-label="排版格式">
      <button type="button" className="editor-source-toggle" onClick={() => setSourceMode(false)}><Eye size={15} />返回富文本</button>
    </div> : toolbarOpen && <div className="editor-toolbar" role="toolbar" aria-label="排版格式"
      onKeyDown={handleToolbarKeyDown} onFocus={handleToolbarFocus}>
      <div className="editor-toolbar-group" role="group" aria-label="编辑历史">
        <ToolbarButton title="撤销" tabIndex={toolbarIndex === 0 ? 0 : -1} disabled={formattingDisabled} onClick={() => runCommand((chain) => chain.undo())}><Undo2 size={15} /></ToolbarButton>
        <ToolbarButton title="重做" tabIndex={toolbarIndex === 1 ? 0 : -1} disabled={formattingDisabled} onClick={() => runCommand((chain) => chain.redo())}><Redo2 size={15} /></ToolbarButton>
      </div>
      <span className="editor-toolbar-divider" role="separator" aria-orientation="vertical" />
      <SelectField className="editor-heading-control" aria-label="标题样式" menuWidth={140} tabIndex={toolbarIndex === 2 ? 0 : -1}
        value={formats?.heading || 0} options={headingOptions} disabled={formattingDisabled}
        onChange={(level) => runCommand((chain) => level ? chain.setHeading({ level }) : chain.setParagraph())} />
      <span className="editor-toolbar-divider" role="separator" aria-orientation="vertical" />
      <div className="editor-toolbar-group" role="group" aria-label="文字和段落">
        <ToolbarButton title="加粗" tabIndex={toolbarIndex === 3 ? 0 : -1} disabled={formattingDisabled} pressed={formats?.bold} onClick={() => runCommand((chain) => chain.toggleBold())}><Bold size={15} /></ToolbarButton>
        <ToolbarButton title="斜体" tabIndex={toolbarIndex === 4 ? 0 : -1} disabled={formattingDisabled} pressed={formats?.italic} onClick={() => runCommand((chain) => chain.toggleItalic())}><Italic size={15} /></ToolbarButton>
        <ToolbarButton title="引用" tabIndex={toolbarIndex === 5 ? 0 : -1} disabled={formattingDisabled} pressed={formats?.blockquote} onClick={() => runCommand((chain) => chain.toggleBlockquote())}><Quote size={15} /></ToolbarButton>
        <ToolbarButton title="无序列表" tabIndex={toolbarIndex === 6 ? 0 : -1} disabled={formattingDisabled} pressed={formats?.bulletList} onClick={() => runCommand((chain) => chain.toggleBulletList())}><List size={15} /></ToolbarButton>
      </div>
      <div className="editor-overflow" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setMoreOpen(false);
      }} onKeyDown={(event) => {
        if (event.key !== 'Escape' || !moreOpen) return;
        event.stopPropagation();
        setMoreOpen(false);
        event.currentTarget.querySelector('[data-editor-control]')?.focus();
      }}>
        <ToolbarButton title="更多排版选项" tabIndex={toolbarIndex === 7 ? 0 : -1} disabled={formattingDisabled}
          aria-expanded={moreOpen} onMouseDown={undefined} onClick={() => setMoreOpen((current) => !current)}><MoreHorizontal size={17} /></ToolbarButton>
        {moreOpen && <div className="editor-overflow-menu" role="group" aria-label="更多排版选项">
          {overflowActions.map((action) => {
            const [Icon, label, pressed, run] = action;
            return <button type="button" key={label} aria-pressed={pressed}
              onMouseDown={(event) => event.preventDefault()} onClick={() => { setMoreOpen(false); run(); }}>
              <Icon size={15} />{label}
            </button>;
          })}
        </div>}
      </div>
    </div>}

    {children}
    {sourceMode ? <textarea className="editor-source-area" aria-label="Markdown 源码" value={sourceValue} disabled={disabled}
      onChange={(event) => { setSourceValue(event.target.value); onChangeRef.current?.(event.target.value); }} />
      : <EditorContent editor={editor} className="editor-content-shell" />}

    {showSelectionMenu && <BubbleMenu editor={editor} pluginKey={selectionPluginKey} ref={menuRef} options={selectionOptions}
      updateDelay={60} shouldShow={shouldShowSelection} className="selection-bubble-menu">
      <div className="selection-bubble-actions" role="group" aria-label="选中文本操作">
        {selectionActions.map(([mode, label]) => <button key={mode} type="button" disabled={selectionLoading}
          onMouseDown={(event) => event.preventDefault()} onClick={() => runSelection(mode)}>{label}</button>)}
        <button className="selection-instruction-toggle" type="button" aria-label="补充选区要求" title="补充选区要求"
          aria-expanded={instructionOpen} disabled={selectionLoading}
          onClick={() => { if (instructionOpen) { setInstruction(''); editor.commands.focus(); } setInstructionOpen(!instructionOpen); }}>
          <SlidersHorizontal size={15} />
        </button>
      </div>
      {instructionOpen && <input className="selection-instruction" autoFocus value={instruction}
        aria-label="选区修改要求" placeholder="补充语气或篇幅要求…" title="Enter 提交润色"
        onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Escape') {
            event.stopPropagation();
            setInstruction('');
            setInstructionOpen(false);
            editor.commands.focus();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            runSelection('POLISH_SELECTION');
          }
        }} />}
    </BubbleMenu>}
  </div>;
}
