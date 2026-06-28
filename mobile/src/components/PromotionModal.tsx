import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { pieceSrc } from "../pieces";
import { colors } from "../theme";
import type { PendingPromotion, PromoPiece } from "../useChessGame";

const PIECES: PromoPiece[] = ["q", "r", "b", "n"];

export function PromotionModal({
  promotion,
  onChoose,
  onCancel,
}: {
  promotion: PendingPromotion | null;
  onChoose: (piece: PromoPiece) => void;
  onCancel: () => void;
}) {
  const white = promotion?.color === 0;

  return (
    <Modal
      visible={promotion !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <View style={styles.card}>
          <Text style={styles.title}>Promote to…</Text>
          <View style={styles.row}>
            {PIECES.map((p) => {
              const glyph = white ? p.toUpperCase() : p;
              const src = pieceSrc(glyph);
              return (
                <Pressable
                  key={p}
                  style={styles.choice}
                  onPress={() => onChoose(p)}
                >
                  {src && <Image source={src} style={styles.icon} resizeMode="contain" />}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    padding: 18,
  },
  title: {
    color: colors.subtext,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 12,
  },
  row: { flexDirection: "row", gap: 12 },
  choice: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.panelBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { width: 46, height: 46 },
});
