export function appendMessageToSession<T extends { id: string }>(existing: T[], msg: T): T[];
export function mergeMessagesBySession<T extends { id: string; session_id: string }>(
  messagesBySession: Record<string, T[]>,
  msgs: T[]
): Record<string, T[]>;
