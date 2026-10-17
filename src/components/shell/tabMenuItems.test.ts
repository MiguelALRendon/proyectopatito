import { describe, expect, it, vi } from 'vitest';
import { tabMenuItems, type TabMenuState } from './tabMenuItems';

const actions = {
  close: vi.fn(),
  closeOthers: vi.fn(),
  closeToTheRight: vi.fn(),
  duplicate: vi.fn(),
};

function disabledLabels(state: TabMenuState): string[] {
  return tabMenuItems(state, actions)
    .filter((item) => item.disabled)
    .map((item) => item.label);
}

describe('tabMenuItems', () => {
  it('lists the four actions with the shortcut and the separator', () => {
    const items = tabMenuItems({ index: 0, count: 2, canOpen: true }, actions);
    expect(items.map((item) => item.label)).toEqual([
      'Cerrar',
      'Cerrar otras',
      'Cerrar a la derecha',
      'Duplicar',
    ]);
    expect(items[0].shortcut).toBe('Supr');
    expect(items[3].separatorBefore).toBe(true);
  });

  it('disables what cannot apply to a single, last tab', () => {
    expect(disabledLabels({ index: 0, count: 1, canOpen: true })).toEqual([
      'Cerrar otras',
      'Cerrar a la derecha',
    ]);
  });

  it('disables duplicate at the tab limit only', () => {
    expect(disabledLabels({ index: 0, count: 3, canOpen: false })).toEqual([
      'Duplicar',
    ]);
  });

  it('runs the action it was given', () => {
    tabMenuItems({ index: 0, count: 2, canOpen: true }, actions)[0].action();
    expect(actions.close).toHaveBeenCalledTimes(1);
  });
});
