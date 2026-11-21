import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { Side } from '../../types'
import { storageRootOf } from '../../utils/path'

export interface PanelState {
  storage: string
  path: string
  selected: string[]
  anchor: string | null
  showHidden: boolean
}

export interface PanelsState {
  left: PanelState
  right: PanelState
  active: Side
}

const emptyPanel = (): PanelState => ({
  storage: '',
  path: '/',
  selected: [],
  anchor: null,
  showHidden: false,
})

const initialState: PanelsState = {
  left: emptyPanel(),
  right: emptyPanel(),
  active: 'left',
}

const slice = createSlice({
  name: 'panels',
  initialState,
  reducers: {
    setActive(state, action: PayloadAction<Side>) {
      state.active = action.payload
    },
    setStorage(state, action: PayloadAction<{ side: Side; storage: string }>) {
      const panel = state[action.payload.side]
      panel.storage = action.payload.storage
      panel.path = storageRootOf(action.payload.storage)
      panel.selected = []
      panel.anchor = null
    },
    navigate(state, action: PayloadAction<{ side: Side; path: string }>) {
      const panel = state[action.payload.side]
      panel.path = action.payload.path
      panel.selected = []
      panel.anchor = null
    },
    select(state, action: PayloadAction<{ side: Side; names: string[]; anchor?: string | null }>) {
      const panel = state[action.payload.side]
      panel.selected = action.payload.names
      if (action.payload.anchor !== undefined) panel.anchor = action.payload.anchor
    },
    toggleHidden(state, action: PayloadAction<Side>) {
      const panel = state[action.payload]
      panel.showHidden = !panel.showHidden
      panel.selected = []
      panel.anchor = null
    },
  },
})

export const { setActive, setStorage, navigate, select, toggleHidden } = slice.actions
export default slice.reducer
