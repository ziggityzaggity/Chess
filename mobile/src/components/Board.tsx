import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { FILES, pieceSrc } from "../pieces";
import { colors } from "../theme";
import type { GameSnapshot } from "../useChessGame";

interface BoardProps {
  snapshot: GameSnapshot;
  selected: number;
  legalTargets: number[];
  flipped: boolean;
  size: number;
  onSquarePress: (square: number) => void;
}

export function Board({
  snapshot,
  selected,
  legalTargets,
  flipped,
  size,
  onSquarePress,
}: BoardProps) {
  const sq = size / 8;

  return (
    <View style={[styles.board, { width: size, height: size }]}>
      {Array.from({ length: 64 }, (_, vis) => {
        const square = flipped ? 63 - vis : vis;
        const row = square >> 3;
        const col = square & 7;
        const visRow = vis >> 3;
        const visCol = vis & 7;
        const isLight = ((row + col) & 1) === 0;

        const glyph = snapshot.board[square];
        const src = pieceSrc(glyph);

        const isSelected = square === selected;
        const isLast =
          square === snapshot.lastFrom || square === snapshot.lastTo;
        const isCheck = square === snapshot.checkSquare;
        const isTarget = legalTargets.includes(square);
        const isCapture = isTarget && glyph !== ".";

        const labelColor = isLight ? colors.boardDark : colors.boardLight;

        return (
          <Pressable
            key={vis}
            onPress={() => onSquarePress(square)}
            style={[
              styles.square,
              {
                width: sq,
                height: sq,
                backgroundColor: isLight ? colors.boardLight : colors.boardDark,
              },
            ]}
          >
            {isLast && (
              <View style={[styles.fill, { backgroundColor: colors.lastMove }]} />
            )}
            {isSelected && (
              <View style={[styles.fill, { backgroundColor: colors.selected }]} />
            )}
            {isCheck && (
              <View style={[styles.fill, { backgroundColor: colors.check }]} />
            )}

            {visCol === 0 && (
              <Text style={[styles.rankLabel, { color: labelColor }]}>
                {8 - row}
              </Text>
            )}
            {visRow === 7 && (
              <Text style={[styles.fileLabel, { color: labelColor }]}>
                {FILES[col]}
              </Text>
            )}

            {isTarget &&
              (isCapture ? (
                <View
                  style={[
                    styles.captureRing,
                    { borderWidth: Math.max(3, sq * 0.07) },
                  ]}
                />
              ) : (
                <View
                  style={[
                    styles.moveDot,
                    { width: sq * 0.3, height: sq * 0.3, borderRadius: sq * 0.15 },
                  ]}
                />
              ))}

            {src && (
              <Image
                source={src}
                style={{ width: sq * 0.82, height: sq * 0.82 }}
                resizeMode="contain"
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderRadius: 14,
    overflow: "hidden",
  },
  square: {
    alignItems: "center",
    justifyContent: "center",
  },
  fill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  rankLabel: {
    position: "absolute",
    top: 2,
    left: 3,
    fontSize: 10,
    fontWeight: "700",
  },
  fileLabel: {
    position: "absolute",
    bottom: 1,
    right: 3,
    fontSize: 10,
    fontWeight: "700",
  },
  moveDot: {
    position: "absolute",
    backgroundColor: colors.dot,
  },
  captureRing: {
    position: "absolute",
    width: "86%",
    height: "86%",
    borderRadius: 999,
    borderColor: colors.dot,
  },
});
