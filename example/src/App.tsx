import { Text, View, StyleSheet } from 'react-native';
import { getModelVersion } from 'react-native-parking-guide';

const modelVersion = getModelVersion();

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Model version: {modelVersion}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
