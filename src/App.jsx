import { useState, useEffect, useMemo, useCallback } from 'react'

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

// 创建子文件夹
async function createSubDir(rootHandle, path) {
  const parts = path.split('/'), dirName = parts.pop()
  const parent = parts.length ? await getSubDir(rootHandle, parts.join('/')) : rootHandle
  await parent.getDirectoryHandle(dirName, { create: true })
}

const safeId = (name) => name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_') || 'untitled'

// 目录树节点
function TreeNode({ node, depth, selectedDir, selectedFile, onSelectDir, onSelectFile, openDirs, toggleDir }) {
  const isDir = node.kind === 'dir', isOpen = openDirs.has(node.path)
  const sel = isDir ? selectedDir === node.path : selectedFile === node.path
  return <>
    <div className={`tree-item ${isDir ? `folder${isOpen ? ' open' : ''}` : 'file'}${sel ? ' selected' : ''}`}
      style={{ paddingLeft: depth * 16 + 12 }}
      onClick={() => isDir ? (toggleDir(node.path), onSelectDir(node.path)) : onSelectFile(node.path)}>
      {node.name.replace(/\.json$/, '')}
    </div>
    {isDir && isOpen && <div className="tree-children">
      {node.children.map(c => <TreeNode key={c.path} node={c} depth={depth + 1} selectedDir={selectedDir} selectedFile={selectedFile}
        onSelectDir={onSelectDir} onSelectFile={onSelectFile} openDirs={openDirs} toggleDir={toggleDir} />)}
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
  return <div className="prompt-view">
    <div className="view-header">
      <h2>{prompt.name}</h2>
      <button className="btn-primary" onClick={onEdit}>编辑</button>
    </div>
    {(prompt.tags || []).length > 0 && <div className="view-tags">{prompt.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>}
    <div className="lang-tabs">
      <div className={`lang-tab${lang === 'zh' ? ' active' : ''}`} onClick={() => setLang('zh')}>中文版本</div>
      <div className={`lang-tab${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>English</div>
    </div>
    <div className="view-content">{prompt[lang] || <span className="empty-text">暂无内容</span>}</div>
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

  // 选中文件
  const selectFile = (path) => { setSelectedFile(path); setEditing(false) }
  // 选中目录
  const selectDir = (path) => setSelectedDir(path)

  // 新建提示词（在当前选中目录下）
  const newPrompt = () => {
    const id = (selectedDir ? selectedDir + '/' : '') + `prompt_${Date.now()}`
    setPrompts(p => ({ ...p, [id]: { name: '新提示词', tags: [], zh: '', en: '', note: '' } }))
    setSelectedFile(id); setEditing(true)
  }

  // 新建文件夹
  const confirmNewFolder = async (name) => {
    const path = (selectedDir ? selectedDir + '/' : '') + name
    await createSubDir(dirHandle, path)
    setShowNewFolder(false)
    setOpenDirs(s => new Set([...s, selectedDir || '']))
    refresh()
  }

  // 保存提示词
  const savePrompt = async (oldId, data) => {
    const newId = (oldId.includes('/') ? oldId.split('/').slice(0, -1).join('/') + '/' : '') + safeId(data.name)
    if (oldId !== newId && prompts[oldId] && !oldId.split('/').pop().startsWith('prompt_')) {
      try { await deleteFile(dirHandle, oldId) } catch {}
    }
    await writeFile(dirHandle, newId, data)
    setPrompts(p => { const n = { ...p, [newId]: data }; if (oldId !== newId) delete n[oldId]; return n })
    setSelectedFile(newId); setEditing(false)
    refresh()
  }

  // 删除提示词
  const removePrompt = async (id) => {
    if (!id.split('/').pop().startsWith('prompt_')) await deleteFile(dirHandle, id).catch(() => {})
    setPrompts(p => { const n = { ...p }; delete n[id]; return n })
    setSelectedFile(null); setEditing(false)
    refresh()
  }

  const current = selectedFile && prompts[selectedFile]

  return <>
    <div className="toolbar">
      <button onClick={openFolder}>{dirHandle ? '切换文件夹' : '打开文件夹'}</button>
      {dirHandle && <>
        <button onClick={newPrompt}>+ 新建提示词</button>
        <button onClick={() => setShowNewFolder(true)}>📁 新建文件夹</button>
        <button onClick={refresh}>刷新</button>
      </>}
      <span className="folder-name">{dirHandle?.name || '未选择文件夹'}</span>
    </div>
    <div className="main">
      {dirHandle && <div className="sidebar">
        {allTags.length > 0 && <div className="sidebar-section">
          <h3>标签筛选</h3>
          <div className="tag-filters">{allTags.map(t =>
            <span key={t} className={`tag-chip${activeTags.has(t) ? ' active' : ''}`} onClick={() => toggleTag(t)}>{t}</span>
          )}</div>
        </div>}
        <div className="tree">
          {tree.map(n => <TreeNode key={n.path} node={n} depth={0} selectedDir={selectedDir} selectedFile={selectedFile}
            onSelectDir={selectDir} onSelectFile={selectFile} openDirs={openDirs} toggleDir={toggleDir} />)}
        </div>
        {showNewFolder && <NewFolderInput onConfirm={confirmNewFolder} onCancel={() => setShowNewFolder(false)} />}
      </div>}
      <div className="content">
        {!dirHandle && <div className="empty"><span>点击「打开文件夹」选择提示词目录</span></div>}
        {dirHandle && !current && <div className="prompt-list">
          {filtered.length === 0 && <div className="empty-hint">暂无提示词，点击「+ 新建提示词」创建</div>}
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
