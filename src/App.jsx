import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

// 读取目录，构建目录树
async function readDir(handle, path = '') {
  const entries = []
  for await (const [name, h] of handle) {
    const fullPath = path ? `${path}/${name}` : name
    if (h.kind === 'directory') entries.push({ name, path: fullPath, kind: 'dir', children: await readDir(h, fullPath) })
    else if (name.endsWith('.json')) entries.push({ name, path: fullPath.replace(/\.json$/, ''), kind: 'file' })
  }
  return entries.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1)
}

// 递归读取所有json提示词
async function loadPrompts(handle) {
  const prompts = {}
  async function walk(h, prefix = '') {
    for await (const [name, fh] of h) {
      if (fh.kind === 'directory') await walk(fh, prefix ? `${prefix}/${name}` : name)
      else if (name.endsWith('.json')) {
        const id = (prefix ? `${prefix}/` : '') + name.replace(/\.json$/, '')
        try { prompts[id] = JSON.parse(await (await fh.getFile()).text()) } catch {}
      }
    }
  }
  await walk(handle)
  return prompts
}

// 获取子目录句柄
async function getSubDir(handle, path) {
  let h = handle
  for (const p of path.split('/')) h = await h.getDirectoryHandle(p)
  return h
}

// 写入json文件
async function writeFile(rootHandle, id, data) {
  const parts = id.split('/'), fname = parts.pop() + '.json'
  const dir = parts.length ? await getSubDir(rootHandle, parts.join('/')) : rootHandle
  const fh = await dir.getFileHandle(fname, { create: true })
  const w = await fh.createWritable(); await w.write(JSON.stringify(data, null, 2)); await w.close()
}

// 删除文件
async function deleteFile(rootHandle, id) {
  const parts = id.split('/'), fname = parts.pop() + '.json'
  const dir = parts.length ? await getSubDir(rootHandle, parts.join('/')) : rootHandle
  await dir.removeEntry(fname)
}

// 删除文件夹（递归）
async function deleteDir(rootHandle, path) {
  const parts = path.split('/'), dirName = parts.pop()
  const parent = parts.length ? await getSubDir(rootHandle, parts.join('/')) : rootHandle
  await parent.removeEntry(dirName, { recursive: true })
}

// 创建子文件夹
async function createSubDir(rootHandle, path) {
  const parts = path.split('/'), dirName = parts.pop()
  const parent = parts.length ? await getSubDir(rootHandle, parts.join('/')) : rootHandle
  await parent.getDirectoryHandle(dirName, { create: true })
}

// 移动文件到目标目录
async function moveFile(rootHandle, fileId, targetDir) {
  const parts = fileId.split('/'), fname = parts.pop() + '.json'
  const srcDir = parts.length ? await getSubDir(rootHandle, parts.join('/')) : rootHandle
  const dstDir = targetDir ? await getSubDir(rootHandle, targetDir) : rootHandle
  const fh = await srcDir.getFileHandle(fname)
  const w = await dstDir.getFileHandle(fname, { create: true }).then(h => h.createWritable())
  await w.write(await (await fh.getFile()).text()); await w.close()
  await srcDir.removeEntry(fname)
}

// 移动文件夹到目标目录
async function moveFolder(rootHandle, folderPath, targetDir) {
  const folderName = folderPath.split('/').pop()
  const dstDir = targetDir ? await getSubDir(rootHandle, targetDir) : rootHandle
  await dstDir.getDirectoryHandle(folderName, { create: true })
  const src = await getSubDir(rootHandle, folderPath)
  const dst = await getSubDir(dstDir, folderName)
  async function copy(src, dst) {
    for await (const [name, h] of src) {
      if (h.kind === 'directory') { const s = await dst.getDirectoryHandle(name, { create: true }); await copy(h, s) }
      else { const fh = await dst.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(await (await h.getFile()).text()); await w.close() }
    }
  }
  await copy(src, dst)
  const parts = folderPath.split('/'), dn = parts.pop()
  const parent = parts.length ? await getSubDir(rootHandle, parts.join('/')) : rootHandle
  await parent.removeEntry(dn, { recursive: true })
}

const safeId = (name) => name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_') || 'untitled'

// 目录树节点（支持选中切换、拖拽、放置）
function TreeNode({ node, depth, selectedDir, selectedFile, onSelectDir, onSelectFile, openDirs, toggleDir, onDragStart, onDrop, dragOver }) {
  const isDir = node.kind === 'dir', isOpen = openDirs.has(node.path)
  const sel = isDir ? selectedDir === node.path : selectedFile === node.path
  const click = () => {
    if (isDir) { if (selectedDir === node.path) { onSelectDir('') } else { toggleDir(node.path); onSelectDir(node.path) } }
    else { onSelectFile(node.path) }
  }
  const dragStart = (e) => { e.stopPropagation(); onDragStart(node) }
  const dragOverH = (e) => { e.preventDefault(); e.stopPropagation() }
  const drop = (e) => { e.preventDefault(); e.stopPropagation(); if (isDir) onDrop(node.path) }
  return <>
    <div className={`tree-item ${isDir ? `folder${isOpen ? ' open' : ''}` : 'file'}${sel ? ' selected' : ''}${dragOver === node.path ? ' drag-over' : ''}`}
      style={{ paddingLeft: depth * 16 + 12 }}
      onClick={click} draggable onDragStart={dragStart}
      {...(isDir ? { onDragOver: dragOverH, onDrop: drop } : {})}>
      {node.name.replace(/\.json$/, '')}
    </div>
    {isDir && isOpen && <div className="tree-children">
      {node.children.map(c => <TreeNode key={c.path} node={c} depth={depth + 1} selectedDir={selectedDir} selectedFile={selectedFile}
        onSelectDir={onSelectDir} onSelectFile={onSelectFile} openDirs={openDirs} toggleDir={toggleDir}
        onDragStart={onDragStart} onDrop={onDrop} dragOver={dragOver} />)}
    </div>}
  </>
}

// 标签输入
function TagInput({ tags, onChange }) {
  const [input, setInput] = useState('')
  const add = (t) => t && !tags.includes(t) && onChange([...tags, t])
  return <div className="tag-input-wrap" onClick={e => e.currentTarget.querySelector('input')?.focus()}>
    {tags.map(t => <span key={t} className="tag">{t}<button onClick={e => { e.stopPropagation(); onChange(tags.filter(x => x !== t)) }}>×</button></span>)}
    <input value={input} onChange={e => setInput(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.trim()); setInput('') } else if (e.key === 'Backspace' && !input && tags.length) onChange(tags.slice(0, -1)) }}
      onBlur={() => { add(input.trim()); setInput('') }} placeholder="输入标签回车添加" />
  </div>
}

// 提示词展示视图（只读）
function PromptView({ prompt, onEdit }) {
  const [lang, setLang] = useState('zh')
  const [selectedLine, setSelectedLine] = useState(null)
  const [wrap, setWrap] = useState(true)
  const [copied, setCopied] = useState(false)
  const content = prompt[lang] || ''
  const lines = content.split('\n')
  const copyAll = () => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1200) }
  return <div className="prompt-view">
    <div className="view-header">
      <div className="view-title-row">
        <h2>{prompt.name}</h2>
        {(prompt.tags || []).length > 0 && <div className="view-tags">{prompt.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>}
      </div>
      <button className="btn-primary" onClick={onEdit}>编辑</button>
    </div>
    <div className="lang-bar">
      <div className="lang-tabs">
        <div className={`lang-tab${lang === 'zh' ? ' active' : ''}`} onClick={() => { setLang('zh'); setSelectedLine(null) }}>中文版本</div>
        <div className={`lang-tab${lang === 'en' ? ' active' : ''}`} onClick={() => { setLang('en'); setSelectedLine(null) }}>English</div>
      </div>
      {content && <div className="content-toolbar">
        <button className="icon-btn" onClick={copyAll}>{copied ? '✓ 已复制' : '⧉ 复制'}</button>
        <button className="icon-btn" onClick={() => setWrap(!wrap)}>{wrap ? '⇔ 滚动' : '↩ 换行'}</button>
      </div>}
    </div>
    {content ? <div className={`view-content${wrap ? '' : ' no-wrap'}`}>
      {lines.map((line, i) => <div key={i} className={`content-line${selectedLine === i ? ' active' : ''}`} onClick={() => setSelectedLine(i === selectedLine ? null : i)}>{line || '\u00A0'}</div>)}
    </div> : <div className="view-content"><span className="empty-text">暂无内容</span></div>}
    {prompt.note && <div className="view-note"><label>备注</label><p>{prompt.note}</p></div>}
  </div>
}

// 提示词编辑视图
function PromptEditor({ prompt, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState(prompt)
  const [lang, setLang] = useState('zh')
  useEffect(() => setForm(prompt), [prompt])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return <div className="prompt-editor">
    <div className="view-header"><h2>编辑提示词</h2><div className="editor-actions">
      <button className="btn-secondary" onClick={onCancel}>取消</button>
      <button className="btn-primary" onClick={() => onSave(form)}>保存</button>
      <button className="btn-danger" onClick={onDelete}>删除</button>
    </div></div>
    <div className="field"><label>名称</label><input value={form.name} onChange={e => set('name', e.target.value)} /></div>
    <div className="field"><label>标签</label><TagInput tags={form.tags || []} onChange={t => set('tags', t)} /></div>
    <div className="field">
      <div className="lang-tabs">
        <div className={`lang-tab${lang === 'zh' ? ' active' : ''}`} onClick={() => setLang('zh')}>中文版本</div>
        <div className={`lang-tab${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>English</div>
      </div>
      <textarea value={form[lang]} onChange={e => set(lang, e.target.value)} placeholder={lang === 'zh' ? '中文提示词内容...' : 'English prompt content...'} />
    </div>
    <div className="field"><label>备注</label><textarea value={form.note || ''} onChange={e => set('note', e.target.value)} placeholder="备注信息..." style={{ minHeight: 60 }} /></div>
  </div>
}

// 新建文件夹输入
function NewFolderInput({ onConfirm, onCancel }) {
  const [name, setName] = useState('')
  return <div className="inline-input">
    <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="文件夹名称"
      onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); if (e.key === 'Escape') onCancel() }} />
    <button onClick={() => name.trim() && onConfirm(name.trim())}>确定</button>
    <button onClick={onCancel}>取消</button>
  </div>
}

export default function App() {
  const [dirHandle, setDirHandle] = useState(null)
  const [tree, setTree] = useState([])
  const [prompts, setPrompts] = useState({})
  const [selectedFile, setSelectedFile] = useState(null)
  const [selectedDir, setSelectedDir] = useState('')
  const [activeTags, setActiveTags] = useState(new Set())
  const [openDirs, setOpenDirs] = useState(new Set())
  const [editing, setEditing] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [dragNode, setDragNode] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  const refresh = useCallback(async () => {
    if (!dirHandle) return
    const [t, p] = await Promise.all([readDir(dirHandle), loadPrompts(dirHandle)])
    setTree(t); setPrompts(p)
  }, [dirHandle])

  // 打开文件夹
  const openFolder = async () => {
    const h = await window.showDirectoryPicker()
    setDirHandle(h); setSelectedFile(null); setSelectedDir(''); setEditing(false); setOpenDirs(new Set())
    const [t, p] = await Promise.all([readDir(h), loadPrompts(h)])
    setTree(t); setPrompts(p)
  }

  const toggleDir = (p) => setOpenDirs(s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n })
  const toggleTag = (t) => setActiveTags(s => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n })
  const allTags = useMemo(() => [...new Set(Object.values(prompts).flatMap(p => p.tags || []))].sort(), [prompts])
  const filtered = useMemo(() => {
    const list = Object.entries(prompts).map(([id, p]) => ({ id, ...p }))
    return activeTags.size ? list.filter(p => (p.tags || []).some(t => activeTags.has(t))) : list
  }, [prompts, activeTags])

  // 新建提示词（在当前选中目录下）
  const newPrompt = () => {
    const id = (selectedDir ? selectedDir + '/' : '') + `prompt_${Date.now()}`
    setPrompts(p => ({ ...p, [id]: { name: '新提示词', tags: [], zh: '', en: '', note: '' } }))
    setSelectedFile(id); setSelectedDir(''); setEditing(true)
  }

  // 新建文件夹（在当前选中目录下）
  const confirmNewFolder = async (name) => {
    await createSubDir(dirHandle, (selectedDir ? selectedDir + '/' : '') + name)
    setShowNewFolder(false); setOpenDirs(s => new Set([...s, selectedDir])); refresh()
  }

  // 保存提示词
  const savePrompt = async (oldId, data) => {
    const dir = oldId.includes('/') ? oldId.split('/').slice(0, -1).join('/') + '/' : ''
    const newId = dir + safeId(data.name)
    if (oldId !== newId && !oldId.split('/').pop().startsWith('prompt_')) {
      try { await deleteFile(dirHandle, oldId) } catch {}
    }
    await writeFile(dirHandle, newId, data)
    setPrompts(p => { const n = { ...p, [newId]: data }; if (oldId !== newId) delete n[oldId]; return n })
    setSelectedFile(newId); setEditing(false); refresh()
  }

  // 删除提示词
  const removePrompt = async (id) => {
    if (!id.split('/').pop().startsWith('prompt_')) await deleteFile(dirHandle, id).catch(() => {})
    setPrompts(p => { const n = { ...p }; delete n[id]; return n })
    setSelectedFile(null); setEditing(false); refresh()
  }

  // 删除文件夹
  const removeDir = async (path) => {
    if (selectedFile?.startsWith(path + '/') || selectedFile === path) { setSelectedFile(null); setEditing(false) }
    await deleteDir(dirHandle, path); setSelectedDir(''); refresh()
  }

  // 拖拽放置处理
  const handleDrop = async (targetDir) => {
    setDragOver(null)
    if (!dragNode || dragNode.path === targetDir) return
    if (dragNode.path.startsWith(targetDir + '/')) return
    if (dragNode.kind === 'file') await moveFile(dirHandle, dragNode.path, targetDir)
    else if (targetDir.startsWith(dragNode.path + '/')) return
    else await moveFolder(dirHandle, dragNode.path, targetDir)
    setDragNode(null); setSelectedFile(null); refresh()
  }

  // 拖到根区域（移到根目录）
  const handleRootDrop = async (e) => {
    e.preventDefault(); setDragOver(null)
    if (!dragNode || !dragNode.path.includes('/')) return
    if (dragNode.kind === 'file') await moveFile(dirHandle, dragNode.path, '')
    else await moveFolder(dirHandle, dragNode.path, '')
    setDragNode(null); setSelectedFile(null); refresh()
  }

  // 用ref追踪最新状态，供Delete键handler使用
  const stateRef = useRef({})
  stateRef.current = { selectedFile, selectedDir, prompts, dirHandle, editing }

  // Delete键删除选中项
  useEffect(() => {
    const handler = async (e) => {
      if (e.key !== 'Delete' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const { selectedFile: sf, selectedDir: sd } = stateRef.current
      if (sf) {
        if (!sf.split('/').pop().startsWith('prompt_')) await deleteFile(stateRef.current.dirHandle, sf).catch(() => {})
        setPrompts(p => { const n = { ...p }; delete n[sf]; return n })
        setSelectedFile(null); setEditing(false); refresh()
      } else if (sd) {
        if (stateRef.current.selectedFile?.startsWith(sd + '/')) { setSelectedFile(null); setEditing(false) }
        await deleteDir(stateRef.current.dirHandle, sd); setSelectedDir(''); refresh()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [refresh])

  const selectFile = (path) => { setSelectedFile(path === selectedFile ? null : path); setSelectedDir(''); setEditing(false) }
  const current = selectedFile && prompts[selectedFile]

  return <>
    <div className="main">
      {dirHandle && <div className="sidebar">
        {allTags.length > 0 && <div className="sidebar-tags">{allTags.map(t =>
          <span key={t} className={`tag-chip${activeTags.has(t) ? ' active' : ''}`} onClick={() => toggleTag(t)}>{t}</span>
        )}</div>}
        <div className="sidebar-actions">
          <button className="btn-primary" onClick={newPrompt}>+ 提示词</button>
          <button className="btn-secondary" onClick={() => setShowNewFolder(true)}>+ 文件夹</button>
        </div>
        <div className="tree" onDragOver={(e) => e.preventDefault()} onDrop={handleRootDrop}>
          {tree.map(n => <TreeNode key={n.path} node={n} depth={0} selectedDir={selectedDir} selectedFile={selectedFile}
            onSelectDir={setSelectedDir} onSelectFile={selectFile}
            openDirs={openDirs} toggleDir={toggleDir} onDragStart={setDragNode} onDrop={handleDrop} dragOver={dragOver} />)}
        </div>
        {showNewFolder && <NewFolderInput onConfirm={confirmNewFolder} onCancel={() => setShowNewFolder(false)} />}
      </div>}
      <div className="content">
        {!dirHandle && <div className="empty">
          <div className="welcome-card">
            <h2>提示词管理器</h2>
            <p>选择一个本地文件夹来管理你的提示词</p>
            <button className="btn-primary" onClick={openFolder}>选择文件夹</button>
          </div>
        </div>}
        {dirHandle && !current && <div className="prompt-list">
          {filtered.length === 0 && <div className="empty-hint">暂无提示词</div>}
          {filtered.map(p => <div key={p.id} className="prompt-card" onClick={() => selectFile(p.id)}>
            <h4>{p.name}</h4>
            <div className="tags">{(p.tags || []).map(t => <span key={t} className="tag">{t}</span>)}</div>
            <div className="preview">{p.zh || p.en || '暂无内容'}</div>
          </div>)}
        </div>}
        {dirHandle && current && !editing && <PromptView prompt={current} onEdit={() => setEditing(true)} />}
        {dirHandle && current && editing && <PromptEditor key={selectedFile} prompt={current}
          onSave={(d) => savePrompt(selectedFile, d)} onCancel={() => setEditing(false)} onDelete={() => removePrompt(selectedFile)} />}
      </div>
    </div>
  </>
}
