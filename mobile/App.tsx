import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet } from "react-native";
import { PlayScreen } from "./src/PlayScreen";
import { colors } from "./src/theme";

export default function App() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <PlayScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
