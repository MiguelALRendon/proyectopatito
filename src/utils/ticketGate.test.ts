import { describe, expect, it } from 'vitest';
import { createTicketGate } from './ticketGate';

describe('createTicketGate', () => {
  it('only the latest ticket of a key is current', () => {
    const gate = createTicketGate();
    const first = gate.next('a');
    const second = gate.next('a');
    expect(gate.isCurrent('a', first)).toBe(false);
    expect(gate.isCurrent('a', second)).toBe(true);
  });

  it('keeps keys independent', () => {
    const gate = createTicketGate();
    const a = gate.next('a');
    gate.next('b');
    expect(gate.isCurrent('a', a)).toBe(true);
  });

  it('drops a key so older tickets stop being current', () => {
    const gate = createTicketGate();
    const ticket = gate.next('a');
    gate.drop('a');
    expect(gate.isCurrent('a', ticket)).toBe(false);
    expect(gate.next('a')).toBe(1);
  });
});
