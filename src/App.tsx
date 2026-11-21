import { useState } from 'react'
import MountManager from './components/MountManager'
import Panel from './components/Panel'
import TaskBar from './components/TaskBar'
import { useGetConfigQuery } from './features/fs/api'
import { PromptProvider } from './ui/PromptDialog'

type View = 'files' | 'mounts'

export default function App() {
  const { data: config } = useGetConfigQuery()
  const [view, setView] = useState<View>('files')

  return (
    <PromptProvider>
      <div className="app">
        <header className="app-header">
          <span className="brand">Web Disk Manager</span>
          <nav className="app-tabs">
            <button
              className={`tab${view === 'files' ? ' tab-active' : ''}`}
              onClick={() => setView('files')}
            >
              文件管理
            </button>
            <button
              className={`tab${view === 'mounts' ? ' tab-active' : ''}`}
              onClick={() => setView('mounts')}
            >
              挂载管理
            </button>
          </nav>
          <button className="mount-entry-btn" onClick={() => setView('mounts')}>
            挂载 COS / R2 / 网盘
          </button>
          <span className="app-hint">
            {config ? `OpenList: ${config.openlistUrl}${config.hasToken ? '' : '（未配置令牌）'}` : ''}
          </span>
          {view === 'files' && (
            <span className="app-keys">
              F2 重命名 · F3 刷新 · F5 复制 · F6 移动 · F7 新建目录 · F8 删除 · Tab 切换面板
            </span>
          )}
        </header>
        <main className="panes">
          {view === 'files' ? (
            <>
              <Panel side="left" />
              <Panel side="right" />
            </>
          ) : (
            <MountManager />
          )}
        </main>
        <TaskBar />
      </div>
    </PromptProvider>
  )
}
