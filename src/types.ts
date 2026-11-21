export type Side = 'left' | 'right'

export interface FsItem {
  name: string
  size: number
  is_dir: boolean
  modified: string
  sign?: string
  type?: number
}

export interface FsListData {
  content: FsItem[] | null
  total: number
}

export interface FsListResponse {
  code: number
  message: string
  data?: FsListData
}

export interface FsGetResponse {
  code: number
  message: string
  data?: {
    name: string
    raw_url: string
    is_dir: boolean
  }
}

export interface StorageItem {
  name: string
  path: string
}

export interface OpResult {
  code: number
  message: string
}

export interface StorageRecord {
  id: number
  mount_path: string
  order: number
  driver: string
  cache_expiration: number
  status: string
  addition: string
  remark: string
  [key: string]: unknown
}

export interface DriverField {
  name: string
  type: string
  default?: unknown
  options?: string
  required?: boolean
  help?: string
  group?: string
  label?: string
}

export interface DriverInfo {
  common: DriverField[]
  additional: DriverField[]
}

/** OpenList 异步任务（复制 / 移动 / 上传等），state 取值见 TaskState */
export interface TaskInfo {
  id: string
  name: string
  creator: string
  creator_role: number
  state: number
  status: string
  progress: number
  start_time: string | null
  end_time: string | null
  total_bytes: number
  error: string
}

export type TaskKind = 'copy' | 'move'

/** 与 OpenList 内部 tache.State 一一对应 */
export const TaskState = {
  Pending: 0,
  Running: 1,
  Succeeded: 2,
  Canceling: 3,
  Canceled: 4,
  Errored: 5,
  Failing: 6,
  Failed: 7,
  WaitingRetry: 8,
  BeforeRetry: 9,
} as const

/** 可取消的状态：尚未结束、且不是正在结束中 */
export const CANCELABLE_STATES: number[] = [
  TaskState.Pending,
  TaskState.Running,
  TaskState.Errored,
  TaskState.WaitingRetry,
  TaskState.BeforeRetry,
]
