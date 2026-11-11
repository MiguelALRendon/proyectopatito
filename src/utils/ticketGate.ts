export interface TicketGate {
  next: (key: string) => number;
  isCurrent: (key: string, ticket: number) => boolean;
  drop: (key: string) => void;
}

export function createTicketGate(): TicketGate {
  const tickets = new Map<string, number>();
  return {
    next: (key) => {
      const ticket = (tickets.get(key) ?? 0) + 1;
      tickets.set(key, ticket);
      return ticket;
    },
    isCurrent: (key, ticket) => tickets.get(key) === ticket,
    drop: (key) => {
      tickets.delete(key);
    },
  };
}
