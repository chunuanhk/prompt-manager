# 提示词管理器

纯前端提示词管理工具，使用 File System Access API 直接读写本地文件夹中的 `.json` 提示词文件。

## 功能

- **本地文件读写** — 通过浏览器 File System Access API 操作本地文件夹，无需后端服务
- **目录树展示** — 左侧展示完整的文件夹与文件结构，支持展开/折叠子目录
- **提示词编辑** — 支持中文/英文双版本、标签、备注
- **标签筛选** — 侧栏标签 chips 支持多选筛选
- **拖拽移动** — 文件可拖入文件夹，文件夹可拖入其他文件夹或根目录
- **Delete 键删除** — 选中文件或文件夹后按 Delete 键直接删除
- **行高亮阅读** — 内容逐行渲染，点击行高亮显示，支持复制和自动换行/水平滚动切换

## 提示词文件格式

每个提示词为一个 `.json` 文件：

```json
{
  "name": "提示词名称",
  "tags": ["标签1", "标签2"],
  "zh": "中文版本内容",
  "en": "English version content",
  "note": "备注信息"
}
```

## 使用

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`，点击「选择文件夹」选择本地提示词目录即可使用。

> 需要 Chromium 内核浏览器（Chrome / Edge），且必须在 HTTPS 或 localhost 环境下运行。

## 构建

```bash
npm run build
```

产物在 `dist/` 目录。

## 技术栈

- React 19 + Vite 6
- File System Access API
- 纯前端 SPA，无后端依赖
