import { configureStore } from '@reduxjs/toolkit'
import { api } from '../features/fs/api'
import panelsReducer from '../features/panels/panelsSlice'

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    panels: panelsReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
