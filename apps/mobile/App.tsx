/**
 * Arutech Meet — mobile app entry point.
 *
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/root-navigator';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}

export default App;
