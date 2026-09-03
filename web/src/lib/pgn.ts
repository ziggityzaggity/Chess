// Turns a flat list of SAN moves into two-column table rows for the move list.
// Each cell carries the SAN and the "ply after" index (1-based number of moves
// applied once that move is played) so the UI can highlight the current move
// and jump to any position via the engine's undo/redo.

export interface MoveCell {
  san: string;
  ply: number; // engine ply once this move has been played (1-based)
}

export interface MoveRow {
  no: number; // full-move number
  white?: MoveCell;
  black?: MoveCell;
}

/**
 * @param sans        SAN moves in play order.
 * @param startWhite  Whether White made the first move (true for a normal game).
 */
export function toMoveRows(sans: string[], startWhite = true): MoveRow[] {
  const rows: MoveRow[] = [];
  sans.forEach((san, i) => {
    const ply = i + 1;
    // With White starting, even indices (0,2,…) are White's moves.
    const isWhite = startWhite ? i % 2 === 0 : i % 2 === 1;
    const moveNo = startWhite
      ? Math.floor(i / 2) + 1
      : Math.floor((i + 1) / 2) + 1;

    let row = rows[rows.length - 1];
    if (!row || (isWhite && row.white)) {
      row = { no: moveNo };
      rows.push(row);
    }
    if (isWhite) row.white = { san, ply };
    else row.black = { san, ply };
  });
  return rows;
}
