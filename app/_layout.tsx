import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { AppProvider } from '../context/AppContext'
import { ThemeProvider } from '../context/ThemeContext'
import { LangueProvider } from '../context/LangueContext'
import { useEffect } from 'react'
import { inicializarTrial } from '../src/trial'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SplashScreen from 'expo-splash-screen'
import '../src/tasks'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  useEffect(() => {
    inicializarTrial()
    AsyncStorage.getItem('onboardingDone').then(done => {
      if (!done) {
        setTimeout(() => router.replace('/onboarding'), 100)
      }
      // Esconder o splash com pequeno delay para a app estar pronta
      setTimeout(() => SplashScreen.hideAsync(), 300)
    })
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProvider>
        <ThemeProvider>
          <LangueProvider>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            </Stack>
            <StatusBar style="auto" />
          </LangueProvider>
        </ThemeProvider>
      </AppProvider>
    </GestureHandlerRootView>
  )
}
