export const storageRootOf = (storage: string): string => (storage ? '/' + storage : '/')

export function joinPath(base: string, name: string): string {
  const b = String(base || '').replace(/\/+$/, '')
  return `${b}/${name}` || '/'
}

export function parentPath(p: string): string {
  if (!p || p === '/') return '/'
  const parts = p.replace(/\/+$/, '').split('/')
  parts.pop()
  return parts.join('/') || '/'
}

export function basename(p: string): string {
  const parts = String(p || '').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || ''
}

/** 相对存储根的可读路径段，例如 /115/a/b -> ['a', 'b'] */
export function relativeSegments(fullPath: string, storage: string): string[] {
  const root = storageRootOf(storage)
  const rel = fullPath.slice(root.length).replace(/^\/+|\/+$/g, '')
  return rel ? rel.split('/') : []
}
