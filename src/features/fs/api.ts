import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type {
  DriverInfo,
  FsGetResponse,
  FsListResponse,
  OpResult,
  ReuseJob,
  StorageItem,
  StorageRecord,
  TaskInfo,
  TaskKind,
} from '../../types'

interface StoragesResponse {
  code: number
  message: string
  storages: StorageItem[]
}

interface AdminStoragesResponse {
  code: number
  message: string
  data?: { content: StorageRecord[] }
}

interface DriverListResponse {
  code: number
  message: string
  data?: Record<string, unknown> | { name: string; label?: string }[]
}

interface DriverInfoResponse {
  code: number
  message: string
  data?: DriverInfo
}

interface Auth115QrcodeResponse {
  code: number
  message?: string
  data?: { uid: string; time: number; sign: string; source: string; imageUrl: string }
}

interface Auth115StatusResponse {
  code: number
  data?: { status: number; msg: string }
}

interface TaskListResponse {
  code: number
  message: string
  data?: TaskInfo[]
}

interface SimpleResponse {
  code: number
  message: string
  data?: unknown
}

interface DirectLinkResponse {
  code: number
  message: string
  data?: { url: string }
}

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['List', 'Storages', 'Tasks'],
  endpoints: (builder) => ({
    getConfig: builder.query<{ openlistUrl: string; hasToken: boolean }, void>({
      query: () => 'config',
    }),
    getStorages: builder.query<StoragesResponse, void>({
      query: () => 'storages',
      providesTags: ['Storages'],
    }),
    listFiles: builder.query<FsListResponse, { path: string; refresh?: boolean }>({
      query: ({ path, refresh }) => ({
        url: 'fs/list',
        params: { path, refresh: refresh ? 1 : 0 },
      }),
      providesTags: ['List'],
    }),
    getFile: builder.query<FsGetResponse, string>({
      query: (path) => ({ url: 'fs/get', params: { path } }),
    }),
    mkdir: builder.mutation<OpResult, { path: string }>({
      query: (body) => ({ url: 'fs/mkdir', method: 'POST', body }),
      invalidatesTags: ['List'],
    }),
    rename: builder.mutation<OpResult, { path: string; name: string }>({
      query: (body) => ({ url: 'fs/rename', method: 'POST', body }),
      invalidatesTags: ['List'],
    }),
    remove: builder.mutation<OpResult, { dir: string; names: string[] }>({
      query: (body) => ({ url: 'fs/remove', method: 'POST', body }),
      invalidatesTags: ['List'],
    }),
    copy: builder.mutation<OpResult, { src_dir: string; dst_dir: string; names: string[] }>({
      query: (body) => ({ url: 'fs/copy', method: 'POST', body }),
      invalidatesTags: ['List', 'Tasks'],
    }),
    move: builder.mutation<OpResult, { src_dir: string; dst_dir: string; names: string[] }>({
      query: (body) => ({ url: 'fs/move', method: 'POST', body }),
      invalidatesTags: ['List', 'Tasks'],
    }),
    newFile: builder.mutation<OpResult, { path: string }>({
      query: (body) => ({ url: 'fs/newfile', method: 'POST', body }),
      invalidatesTags: ['List'],
    }),
    putFile: builder.mutation<OpResult, { dir: string; file: File }>({
      query: ({ dir, file }) => {
        const form = new FormData()
        form.append('dir', dir)
        form.append('name', file.name)
        form.append('file', file)
        return { url: 'fs/upload', method: 'POST', body: form }
      },
      invalidatesTags: ['List'],
    }),

    // ---- 挂载管理（OpenList 管理端） ----
    adminStorages: builder.query<AdminStoragesResponse, void>({
      query: () => 'admin/storages',
      providesTags: ['Storages'],
    }),
    drivers: builder.query<DriverListResponse, void>({
      query: () => 'admin/drivers',
    }),
    driverInfo: builder.query<DriverInfoResponse, string>({
      query: (driver) => ({ url: 'admin/driver-info', params: { driver } }),
    }),
    createStorage: builder.mutation<OpResult, Record<string, unknown>>({
      query: (body) => ({ url: 'admin/storage/create', method: 'POST', body }),
      invalidatesTags: ['Storages', 'List'],
    }),
    updateStorage: builder.mutation<OpResult, Record<string, unknown>>({
      query: (body) => ({ url: 'admin/storage/update', method: 'POST', body }),
      invalidatesTags: ['Storages', 'List'],
    }),
    deleteStorage: builder.mutation<OpResult, number>({
      query: (id) => ({ url: 'admin/storage/delete', method: 'POST', params: { id } }),
      invalidatesTags: ['Storages', 'List'],
    }),
    toggleStorage: builder.mutation<OpResult, { id: number; enable: boolean }>({
      query: ({ id, enable }) => ({
        url: 'admin/storage/toggle',
        method: 'POST',
        params: { id, enable: enable ? 1 : 0 },
      }),
      invalidatesTags: ['Storages', 'List'],
    }),

    // ---- 网盘扫码授权 ----
    auth115Qrcode: builder.query<Auth115QrcodeResponse, string>({
      query: (source) => ({ url: 'auth/115/qrcode', params: { source } }),
    }),
    auth115Status: builder.query<Auth115StatusResponse, { uid: string; time: number; sign: string }>({
      query: ({ uid, time, sign }) => ({ url: 'auth/115/status', params: { uid, time, sign } }),
    }),

    // ---- 123 云盘「秒传」（按 MD5 复用，绕过 10GB 单文件上限） ----
    // 本地文件：前端算好 md5 直接提交
    reuseLocal: builder.mutation<
      SimpleResponse,
      { dstMount: string; dstDir: string; filename: string; size: number; md5: string }
    >({
      query: (body) => ({ url: 'reuse/local', method: 'POST', body }),
      invalidatesTags: ['List'],
    }),
    // 远程文件：后端读源文件算 md5，返回 jobId 供轮询
    startRemoteReuse: builder.mutation<
      { code: number; message: string; data?: { jobId: string } },
      { srcPath: string; dstMount: string; dstDir: string }
    >({
      query: (body) => ({ url: 'reuse/remote', method: 'POST', body }),
    }),
    getReuseJob: builder.query<{ code: number; message: string; data?: ReuseJob }, string>({
      query: (id) => `reuse/remote/${id}`,
    }),

    // ---- 123 云盘「生成直链」 ----
    // 后端按路径解析出 fileID 后调 123 开放平台取 CDN 直链
    generateDirectLink: builder.query<DirectLinkResponse, string>({
      query: (path) => ({ url: 'pan123/direct-link', params: { path } }),
    }),

    // ---- 传输任务 ----
    // 复制/移动在 OpenList 侧是异步任务，进度需轮询任务列表获取
    taskUndone: builder.query<TaskListResponse, TaskKind>({
      query: (kind) => `task/${kind}/undone`,
      providesTags: ['Tasks'],
    }),
    cancelTask: builder.mutation<OpResult, { kind: TaskKind; tid: string }>({
      query: ({ kind, tid }) => ({ url: `task/${kind}/cancel`, method: 'POST', params: { tid } }),
      invalidatesTags: ['Tasks', 'List'],
    }),
    retryTask: builder.mutation<OpResult, { kind: TaskKind; tid: string }>({
      query: ({ kind, tid }) => ({ url: `task/${kind}/retry`, method: 'POST', params: { tid } }),
      invalidatesTags: ['Tasks'],
    }),
  }),
})

export const {
  useGetConfigQuery,
  useGetStoragesQuery,
  useListFilesQuery,
  useGetFileQuery,
  useLazyGetFileQuery,
  useMkdirMutation,
  useRenameMutation,
  useRemoveMutation,
  useCopyMutation,
  useMoveMutation,
  useNewFileMutation,
  usePutFileMutation,
  useAdminStoragesQuery,
  useDriversQuery,
  useDriverInfoQuery,
  useCreateStorageMutation,
  useUpdateStorageMutation,
  useDeleteStorageMutation,
  useToggleStorageMutation,
  useAuth115QrcodeQuery,
  useLazyAuth115StatusQuery,
  useReuseLocalMutation,
  useStartRemoteReuseMutation,
  useGetReuseJobQuery,
  useLazyGetReuseJobQuery,
  useLazyGenerateDirectLinkQuery,
  useTaskUndoneQuery,
  useCancelTaskMutation,
  useRetryTaskMutation,
} = api
