import React, { createContext, useContext, useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

type ThemeContextType = {
  themeSombre: boolean
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  themeSombre: true,
  toggleTheme: () => {},
})

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [themeSombre, setThemeSombre] = useState(true)

  useEffect(() => {
    const charger = async () => {
      const t = await AsyncStorage.getItem('theme')
      if (t !== null) setThemeSombre(t === 'sombre')
    }
    charger()
  }, [])

  const toggleTheme = async () => {
    const novo = !themeSombre
    setThemeSombre(novo)
    await AsyncStorage.setItem('theme', novo ? 'sombre' : 'clair')
  }

  return (
    <ThemeContext.Provider value={{ themeSombre, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)