import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface PromptOptions {
  title: string
  label?: string
  defaultValue?: string
  placeholder?: string
  okText?: string
}

interface ConfirmOptions {
  title: string
  message?: string
  okText?: string
  danger?: boolean
}

interface PromptApi {
  prompt: (o: PromptOptions) => Promise<string | null>
  confirm: (o: ConfirmOptions) => Promise<boolean>
}

type DialogState =
  | ({ kind: 'prompt'; value: string } & PromptOptions)
  | ({ kind: 'confirm' } & ConfirmOptions)

const Ctx = createContext<PromptApi | null>(null)

export function usePrompt(): PromptApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePrompt must be used within <PromptProvider>')
  return ctx
}

export function PromptProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const resolver = useRef<((value: string | null | boolean) => void) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const settle = useCallback((value: string | null | boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setDialog(null)
  }, [])

  const prompt = useCallback((o: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolver.current = (value) => resolve(value as string | null)
      setDialog({ kind: 'prompt', value: o.defaultValue ?? '', ...o })
    })
  }, [])

  const confirm = useCallback((o: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = (value) => resolve(Boolean(value))
      setDialog({ kind: 'confirm', ...o })
    })
  }, [])

  useEffect(() => {
    if (dialog?.kind === 'prompt') {
      const t = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
      return () => clearTimeout(t)
    }
  }, [dialog])

  const submitPrompt = () => {
    if (dialog?.kind !== 'prompt') return
    const value = dialog.value.trim()
    settle(value ? value : null)
  }

  return (
    <Ctx.Provider value={{ prompt, confirm }}>
      {children}
      {dialog && (
        <div className="modal-overlay" onMouseDown={() => settle(dialog.kind === 'prompt' ? null : false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title">{dialog.title}</div>
            {dialog.kind === 'prompt' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  submitPrompt()
                }}
              >
                {dialog.label && <label className="modal-label">{dialog.label}</label>}
                <input
                  ref={inputRef}
                  className="modal-input"
                  value={dialog.value}
                  placeholder={dialog.placeholder}
                  onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') settle(null)
                  }}
                />
                <div className="modal-actions">
                  <button type="button" className="btn" onClick={() => settle(null)}>
                    取消
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {dialog.okText || '确定'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                {dialog.message && <div className="modal-message">{dialog.message}</div>}
                <div className="modal-actions">
                  <button type="button" className="btn" onClick={() => settle(false)}>
                    取消
                  </button>
                  <button
                    type="button"
                    className={dialog.danger ? 'btn btn-danger' : 'btn btn-primary'}
                    onClick={() => settle(true)}
                  >
                    {dialog.okText || '确定'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
