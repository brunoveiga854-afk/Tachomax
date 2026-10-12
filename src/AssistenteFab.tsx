// src/AssistenteFab.tsx
// Botão flutuante discreto que abre o assistente (/assistente). Usado na Home.
//
// Componente AUTÓNOMO: tem o seu próprio estado (teclado) e não lê nem escreve dados da app. Montado como irmão do
// ScrollView da Home, em posição absoluta no canto inferior direito da área de conteúdo — a barra de separadores fica
// fora deste ecrã, por isso o botão fica sempre acima dela. Esconde-se com o teclado aberto.
import React, { useEffect, useRef, useState } from 'react'
import { Keyboard, TouchableOpacity, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../context/ThemeContext'

const TAMANHO = 48

export function AssistenteFab() {
  const { themeSombre } = useTheme()
  const [teclado, setTeclado] = useState(false)
  const bloqueado = useRef(false)

  useEffect(() => {
    const mostra = Keyboard.addListener('keyboardDidShow', () => setTeclado(true))
    const esconde = Keyboard.addListener('keyboardDidHide', () => setTeclado(false))
    return () => { mostra.remove(); esconde.remove() }
  }, [])

  if (teclado) return null

  const abrir = () => {
    if (bloqueado.current) return // evita abrir duas vezes num duplo toque
    bloqueado.current = true
    setTimeout(() => { bloqueado.current = false }, 800)
    // cast: os tipos de rotas do expo-router só incluem /assistente depois de o Metro os regenerar
    router.push('/assistente' as any)
  }

  return (
    <TouchableOpacity
      onPress={abrir}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Ouvrir l'assistant"
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={[st.fab, { backgroundColor: themeSombre ? '#232840' : '#ffffff', borderColor: 'rgba(245,166,35,0.5)' }]}
    >
      <Ionicons name="chatbubble-ellipses-outline" size={24} color="#f5a623" />
    </TouchableOpacity>
  )
}

const st = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: TAMANHO,
    height: TAMANHO,
    borderRadius: TAMANHO / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
})
