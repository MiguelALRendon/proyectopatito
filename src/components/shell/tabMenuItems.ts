import type { ContextMenuItem } from './ContextMenu.vue';

export const MIN_TABS_TO_CLOSE_OTHERS = 2;
export const CLOSE_SHORTCUT = 'Supr';

export interface TabMenuState {
  index: number;
  count: number;
  canOpen: boolean;
}

export interface TabMenuActions {
  close: () => unknown;
  closeOthers: () => unknown;
  closeToTheRight: () => unknown;
  duplicate: () => unknown;
}

export function tabMenuItems(
  state: TabMenuState,
  actions: TabMenuActions,
): ContextMenuItem[] {
  return [
    { label: 'Cerrar', shortcut: CLOSE_SHORTCUT, action: actions.close },
    {
      label: 'Cerrar otras',
      disabled: state.count < MIN_TABS_TO_CLOSE_OTHERS,
      action: actions.closeOthers,
    },
    {
      label: 'Cerrar a la derecha',
      disabled: state.index === state.count - 1,
      action: actions.closeToTheRight,
    },
    {
      label: 'Duplicar',
      separatorBefore: true,
      disabled: !state.canOpen,
      action: actions.duplicate,
    },
  ];
}
