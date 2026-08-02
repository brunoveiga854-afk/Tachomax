// context/ToastContext.tsx
import React, { createContext, useContext, useState, useRef, useCallback } from 'react'
import { View, Text, StyleSheet } from 'react-native'

type ToastContextType = {
  showToast: (msg: string, durationMs?: number) => void
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} })

const ToastView = ({ message }: { message: string }) => (
  <View style={styles.wrap} pointerEvents="none">
    <Text style={styles.text}>{message}</Text>
  </View>
)

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((text: string, durationMs = 2500) => {
    if (timer.current) clearTimeout(timer.current)
    setMsg(text)
    timer.current = setTimeout(() => setMsg(null), durationMs)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {msg !== null && <ToastView message={msg} />}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 9,
    zIndex: 9999,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
})
