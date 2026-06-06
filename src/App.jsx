import { useState, useEffect, useMemo } from 'react'

// 读取目录句柄，构建目录树（含文件夹和json文件）
async function readDir(handle, path = '') {
  const entries = []
  for await (const [name, h] of handle) {
    const fullPath = path ? `${path}/${name}` : name
    if (h.kind === 'directory') entries.push({ name, path: fullPath, kind: 'dir', children: await readDir(h, fullPath) })
    else if (name.endsWith('.json')) entries.push({ name, path: fullPath.replace(/\.json$/, ''), kind: 'file' })
  }
  return entries.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1)
}

// 递归读取所有json提示词文件，id为相对路径去.json
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
  const parts = path.split('/')
  let h = handle
  for (const p of parts) h = await h.getDirectoryHandle(p)
  return h
}

// 写入json文件到指定路径
async function writeFile(rootHandle, id, data) {
  const parts = id.split('/')
  const fname = parts.pop() + '.json'
  const dir = parts.length ? await getSubDir(rootHandle, parts.join('/')) : rootHandle
  const fh = await dir.getFileHandle(fname, { create: true })
  const w = await fh.createWritable()
  await w.write(JSON.stringify(data, null, 2))
  await w.close()
}

// 删除指定路径的json文件
async function deleteFile(rootHandle, id) {
  const parts = id.split('/')
  const fname = parts.pop() + '.json'
  const dir = parts.length ? await getSubDir(rootHandle, parts.join('/')) : rootHandle
  await dir.removeEntry(fname)
}

// 目录树节点
function TreeNode({ node, depth, selected, onSelect, openDirs, toggleDir }) {
  const isDir = node.kind === 'dir', isOpen = openDirs.has(node.path)
  return <>
    <div className={`tree-item ${isDir ? `folder${isOpen ? ' open' : ''}` : 'file'}${selected === node.path ? ' selected' : ''}`}
      style={{ paddingLeft: depth * 16 + 12 }}
      onClick={() => isDir ? toggleDir(node.path) : onSelect(node.path)}>
      {node.name.replace(/\.json$/, '')}
    </div>
    {isDir && isOpen && <div className="tree-children">
      {node.children.map(c => <TreeNode key={c.path} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} openDirs={openDirs} toggleDir={toggleDir} />)}
    </div>}
  </>
}

// 标签输入组件
function TagInput({ tags, onChange }) {
  const [input, setInput] = useState('')
  const add = (t) => t && !tags.includes(t) && onChange([...tags, t])
  return <div className="tag-input-wrap" onClick={e => e.currentTarget.querySelector('input')?.focus()}>
    {tags.map(t => <span key={t} className="tag">{t}<button onClick={e => { e.stopPropagation(); onChange(tags.filter(x => x !== t)) }}>×</button></span>)}
    <input value={input} onChange={e => setInput(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.trim()); setInput('') } else if (e.key === 'Backspace' && !input && tags.length) onChange(tags.slice(0, -1)) }}
      onBlur={() => { add(input.trim()); setInput('') }}
      placeholder="输入标签回车添加" />
  </div>
}

// 提示词编辑器
function PromptEditor({ prompt, onSave, onDelete, onBack }) {
  const [form, setForm] = useState(prompt)
  const [lang, setLang] = useState('zh')
  useEffect(() => setForm(prompt), [prompt])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return <div className="editor">
    <button className="btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={onBack}>← 返回列表</button>
    <div className="field"><label>名称</label><input value={form.name} onChange={e => set('name', e.target.value)} /></div>
    <div className="field"><label>标签</label><TagInput tags={form.tags} onChange={t => set('tags', t)} /></div>
    <div className="field">
      <div className="lang-tabs">
        <div className={`lang-tab${lang === 'zh' ? ' active' : ''}`} onClick={() => setLang('zh')}>中文版本</div>
        <div className={`lang-tab${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>English</div>
      </div>
      <textarea value={form[lang]} onChange={e => set(lang, e.target.value)} placeholder={lang === 'zh' ? '中文提示词内容...' : 'English prompt content...'} />
    </div>
    <div className="field"><label>备注</label><textarea value={form.note} onChange={e => set('note', e.target.value)} placeholder="备注信息..." style={{ minHeight: 60 }} /></div>
    <div className="editor-actions">
      <button className="btn-primary" onClick={() => onSave(form)}>保存</button>
      <button className="btn-danger" onClick={() => onDelete()}>删除</button>
    </div>
  </div>
}

export default function App() {
  const [dirHandle, setDirHandle] = useState(null)
  const [tree, setTree] = useState([])
  const [prompts, setPrompts] = useState({})
  const [selected, setSelected] = useState(null)
  const [activeTags, setActiveTags] = useState(new Set())
  const [openDirs, setOpenDirs] = useState(new Set())

  // 打开文件夹
  const openFolder = async () => {
    const h = await window.showDirectoryPicker()
    setDirHandle(h)
    const [t, p] = await Promise.all([readDir(h), loadPrompts(h)])
    setTree(t); setPrompts(p); setSelected(null); setOpenDirs(new Set())
  }

  // 刷新目录
  const refresh = async () => {
    if (!dirHandle) return
    const [t, p] = await Promise.all([readDir(dirHandle), loadPrompts(dirHandle)])
    setTree(t); setPrompts(p)
  }

  const toggleDir = (p) => setOpenDirs(s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n })
  const toggleTag = (t) => setActiveTags(s => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n })

  const allTags = useMemo(() => [...new Set(Object.values(prompts).flatMap(p => p.tags || []))].sort(), [prompts])

  // 根据活跃标签筛选
  const filtered = useMemo(() => {
    const list = Object.entries(prompts).map(([id, p]) => ({ id, ...p }))
    return activeTags.size ? list.filter(p => (p.tags || []).some(t => activeTags.has(t))) : list
  }, [prompts, activeTags])

  // 从名称生成文件安全的id
  const safeId = (name) => name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_') || 'untitled'
  
  // 保存提示词：按名称生成文件名，处理id迁移
  const savePrompt = async (oldId, data) => {
    const newId = safeId(data.name)
    if (oldId !== newId && prompts[oldId] && !oldId.startsWith('prompt_')) {
      try { await deleteFile(dirHandle, oldId) } catch {}
    }
    await writeFile(dirHandle, newId, data)
    setPrompts(p => {
      const n = { ...p, [newId]: data }
      if (oldId !== newId) delete n[oldId]
      return n
    })
    setSelected(newId)
    refresh()
  }

  // 删除提示词：未落盘的新提示词仅移除state
  const removePrompt = async (id) => {
    if (!id.startsWith('prompt_')) await deleteFile(dirHandle, id).catch(() => {})
    setPrompts(p => { const n = { ...p }; delete n[id]; return n })
    setSelected(null)
    refresh()
  }

  // 新建提示词
  const newPrompt = () => {
    const id = `prompt_${Date.now()}`
    const data = { name: '新提示词', tags: [], zh: '', en: '', note: '' }
    setPrompts(p => ({ ...p, [id]: data }))
    setSelected(id)
  }

  return <>
    <div className="toolbar">
      <button onClick={openFolder}>{dirHandle ? '切换文件夹' : '打开文件夹'}</button>
      {dirHandle && <><button onClick={newPrompt}>+ 新建提示词</button><button onClick={refresh}>刷新</button></>}
      <span className="folder-name">{dirHandle?.name || '未选择文件夹'}</span>
    </div>
    <div className="main">
      {dirHandle && <div className="sidebar">
        {allTags.length > 0 && <div className="sidebar-section">
          <h3>标签筛选</h3>
          <div className="tag-filters">
            {allTags.map(t => <span key={t} className={`tag-chip${activeTags.has(t) ? ' active' : ''}`} onClick={() => toggleTag(t)}>{t}</span>)}
          </div>
        </div>}
        <div className="tree">
          {tree.map(n => <TreeNode key={n.path} node={n} depth={0} selected={selected} onSelect={setSelected} openDirs={openDirs} toggleDir={toggleDir} />)}
        </div>
      </div>}
      <div className="content">
        {!dirHandle && <div className="empty"><span>点击「打开文件夹」选择提示词目录</span></div>}
        {dirHandle && !selected && <div className="prompt-list">
          {filtered.length === 0 && <div style={{ color: '#b2bec3', textAlign: 'center', marginTop: 40 }}>暂无提示词，点击「+ 新建提示词」创建</div>}
          {filtered.map(p => <div key={p.id} className="prompt-card" onClick={() => setSelected(p.id)}>
            <h4>{p.name}</h4>
            <div className="tags">{(p.tags || []).map(t => <span key={t} className="tag">{t}</span>)}</div>
            <div className="preview">{p.zh || p.en || '暂无内容'}</div>
          </div>)}
        </div>}
        {dirHandle && selected && prompts[selected] && <PromptEditor key={selected} prompt={prompts[selected]}
          onSave={(d) => savePrompt(selected, d)} onDelete={() => removePrompt(selected)} onBack={() => setSelected(null)} />}
      </div>
    </div>
  </>
}
