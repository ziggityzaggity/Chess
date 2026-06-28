import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Board } from "./components/Board";
import { PromotionModal } from "./components/PromotionModal";
import { colors } from "./theme";
import { useChessGame, type GameSnapshot } from "./useChessGame";

const RESULT = ["", "White wins", "Black wins", "Draw"];
const DRAW = [
  "",
  "stalemate",
  "the 50-move rule",
  "threefold repetition",
  "insufficient material",
];

function statusText(s: GameSnapshot): string {
  if (s.gameOver) {
    if (s.result === 3) return `Draw by ${DRAW[s.drawReason] ?? "agreement"}`;
    const base = RESULT[s.result] || "Game over";
    return s.isCheckmate ? `${base} by checkmate` : base;
  }
  const side = s.turn === 0 ? "White" : "Black";
  return s.inCheck ? `${side} to move — check!` : `${side} to move`;
}

export function PlayScreen() {
  const game = useChessGame();
  const { width } = useWindowDimensions();
  const boardSize = Math.min(width - 24, 460);

  const ready = game.status === "ready" && game.snapshot !== null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoGlyph}>♞</Text>
        </View>
        <Text style={styles.brand}>Gambit</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {ready ? (
          <Board
            snapshot={game.snapshot!}
            selected={game.selected}
            legalTargets={game.legalTargets}
            flipped={game.flipped}
            size={boardSize}
            onSquarePress={game.onSquarePress}
          />
        ) : (
          <Placeholder
            size={boardSize}
            status={game.status}
            error={game.error}
          />
        )}

        {ready && <StatusCard snapshot={game.snapshot!} />}

        <View style={styles.controls}>
          <ControlButton label="New game" primary disabled={!ready} onPress={game.newGame} />
          <ControlButton label="Flip" disabled={!ready} onPress={game.flip} />
          <ControlButton
            label="↶ Undo"
            disabled={!ready || !game.snapshot!.canUndo}
            onPress={game.undo}
          />
          <ControlButton
            label="Redo ↷"
            disabled={!ready || !game.snapshot!.canRedo}
            onPress={game.redo}
          />
        </View>

        {ready && <MoveList pgn={game.snapshot!.pgn} />}
      </ScrollView>

      <PromotionModal
        promotion={game.promotion}
        onChoose={game.choosePromotion}
        onCancel={game.cancelPromotion}
      />
    </View>
  );
}

function StatusCard({ snapshot }: { snapshot: GameSnapshot }) {
  const turnWhite = snapshot.turn === 0;
  return (
    <View style={styles.statusCard}>
      <View
        style={[
          styles.turnDot,
          {
            backgroundColor: snapshot.gameOver
              ? colors.brand
              : turnWhite
                ? "#ffffff"
                : "#0b1220",
          },
        ]}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.statusText}>{statusText(snapshot)}</Text>
        <Text style={styles.statusSub}>
          Move {Math.floor(snapshot.ply / 2) + 1} · {snapshot.ply} ply
        </Text>
      </View>
    </View>
  );
}

function MoveList({ pgn }: { pgn: string }) {
  const rows = useMemo(() => parsePgn(pgn), [pgn]);
  return (
    <View style={styles.moves}>
      <Text style={styles.movesHeader}>MOVES</Text>
      {rows.length === 0 ? (
        <Text style={styles.movesEmpty}>No moves yet — make the first move.</Text>
      ) : (
        rows.map((r) => (
          <View key={r.no} style={styles.moveRow}>
            <Text style={styles.moveNo}>{r.no}.</Text>
            <Text style={styles.moveCell}>{r.white ?? ""}</Text>
            <Text style={styles.moveCell}>{r.black ?? ""}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function ControlButton({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        primary ? styles.btnPrimary : styles.btnGhost,
        disabled && styles.btnDisabled,
      ]}
    >
      <Text style={[styles.btnText, primary && styles.btnTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Placeholder({
  size,
  status,
  error,
}: {
  size: number;
  status: string;
  error: string | null;
}) {
  return (
    <View style={[styles.placeholder, { width: size, height: size }]}>
      {status === "error" ? (
        <>
          <Text style={styles.phTitle}>Native engine not loaded</Text>
          <Text style={styles.phBody}>
            The C++ chess module needs a native build — it can&apos;t run in Expo
            Go. Build a dev client:
          </Text>
          <Text style={styles.phCode}>npx expo run:ios{"\n"}npx expo run:android</Text>
          {error ? <Text style={styles.phErr}>{error}</Text> : null}
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.phBody}>Starting engine…</Text>
        </>
      )}
    </View>
  );
}

interface MoveRow {
  no: number;
  white?: string;
  black?: string;
}

function parsePgn(pgn: string): MoveRow[] {
  const tokens = pgn.trim().split(/\s+/).filter(Boolean);
  const rows: MoveRow[] = [];
  let current: MoveRow | null = null;
  for (const token of tokens) {
    const numbered = token.match(/^(\d+)\.(\.\.)?$/);
    if (numbered) {
      current = { no: parseInt(numbered[1], 10) };
      if (numbered[2]) current.white = "…";
      rows.push(current);
      continue;
    }
    if (!current) {
      current = { no: rows.length + 1 };
      rows.push(current);
    }
    if (current.white === undefined) current.white = token;
    else if (current.black === undefined) current.black = token;
  }
  return rows;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.panelBorder,
  },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  logoGlyph: { fontSize: 20, color: colors.brandInk, fontWeight: "900" },
  brand: { color: "#fff", fontSize: 18, fontWeight: "800" },
  scroll: { padding: 12, alignItems: "center", gap: 14 },

  statusCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    borderRadius: 16,
    padding: 14,
  },
  turnDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
  },
  statusText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  statusSub: { color: colors.subtext, fontSize: 12, marginTop: 2 },

  controls: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  btn: {
    flexGrow: 1,
    flexBasis: "47%",
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
  },
  btnPrimary: { backgroundColor: colors.brand },
  btnGhost: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.panelBorder,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: colors.text, fontWeight: "700" },
  btnTextPrimary: { color: colors.brandInk },

  moves: {
    width: "100%",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    borderRadius: 16,
    padding: 14,
  },
  movesHeader: {
    color: colors.subtext,
    fontWeight: "700",
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 8,
  },
  movesEmpty: { color: colors.subtext, textAlign: "center", paddingVertical: 16 },
  moveRow: { flexDirection: "row", paddingVertical: 3 },
  moveNo: { color: colors.subtext, width: 34, fontSize: 13 },
  moveCell: { color: colors.text, flex: 1, fontWeight: "600", fontSize: 13 },

  placeholder: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  phTitle: { color: colors.danger, fontWeight: "700", fontSize: 16 },
  phBody: { color: colors.subtext, textAlign: "center", fontSize: 13 },
  phCode: {
    color: colors.text,
    fontFamily: "monospace",
    backgroundColor: colors.bgElevated,
    padding: 10,
    borderRadius: 8,
    textAlign: "center",
    overflow: "hidden",
  },
  phErr: { color: colors.subtext, fontSize: 11, textAlign: "center" },
});
