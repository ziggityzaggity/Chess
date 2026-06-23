import { pieceSrc } from "@/lib/pieces";

// A non-interactive board used for decoration (e.g. the home hero). `board` is a
// 64-char, row-major string ('.' = empty, PNBRQK / pnbrqk).
export function StaticBoard({
  board,
  className = "",
}: {
  board: string;
  className?: string;
}) {
  return (
    <div
      className={`aspect-square w-full overflow-hidden rounded-2xl shadow-board ring-1 ring-black/50 ${className}`}
    >
      <div className="grid h-full w-full grid-cols-8 grid-rows-8">
        {Array.from({ length: 64 }, (_, sq) => {
          const row = sq >> 3;
          const col = sq & 7;
          const isLight = ((row + col) & 1) === 0;
          const src = pieceSrc(board[sq] ?? ".");
          return (
            <div
              key={sq}
              className={`relative flex items-center justify-center ${
                isLight ? "bg-board-light" : "bg-board-dark"
              }`}
            >
              {src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="h-[80%] w-[80%] object-contain drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Standard starting position, for decoration.
export const START_BOARD =
  "rnbqkbnr" +
  "pppppppp" +
  "................" +
  "................" +
  "PPPPPPPP" +
  "RNBQKBNR";
