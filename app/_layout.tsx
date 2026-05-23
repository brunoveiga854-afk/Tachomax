import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ThemeProvider } from '../context/ThemeContext'
import { LangueProvider } from '../context/LangueContext'
import { useEffect } from 'react'
import { inicializarTrial } from '../src/trial'

export default function RootLayout() {
  useEffect(() => {
    inicializarTrial()
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <LangueProvider>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="auto" />
        </LangueProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}