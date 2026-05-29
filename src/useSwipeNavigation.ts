import { useRef } from 'react'
import { PanResponder, Dimensions, Animated } from 'react-native'
import { router } from 'expo-router'

const { width: W } = Dimensions.get('window')

const TABS = [
  '/(tabs)/',
  '/(tabs)/historique',
  '/(tabs)/fiche',
  '/(tabs)/reglages',
]

// Largura da zona de activação nas bordas (px)
const EDGE_ZONE = W * 0.22   // 22% de cada lado
const THRESHOLD = 55          // px mínimos para confirmar navegação
const VELOCITY  = 0.35        // velocidade mínima alternativa

/**
 * Swipe entre tabs activado apenas nas BORDAS do ecrã.
 * Evita conflito com Swipeable cards, ScrollViews horizontais, etc.
 *
 * Devolve { panHandlers, translateX } — aplica ambos no SafeAreaView:
 *   <Animated.View style={{ flex:1, transform:[{translateX}] }} {...panHandlers}>
 */
export function useSwipeNavigation(currentIndex: number, disabled = false) {
  const translateX = useRef(new Animated.Value(0)).current
  const startX     = useRef(0)
  const active     = useRef(false)

  const panResponder = useRef(
    PanResponder.create({

      // Regista o ponto inicial; só activa se vier de uma borda
      onStartShouldSetPanResponder: (e) => {
        if (disabled) return false
        startX.current = e.nativeEvent.pageX
        return false   // não captura ainda, só regista
      },

      // Activa quando o movimento é claramente horizontal E vem de uma borda
      onMoveShouldSetPanResponder: (_, g) => {
        if (disabled) return false
        const fromLeftEdge  = startX.current < EDGE_ZONE
        const fromRightEdge = startX.current > W - EDGE_ZONE
        const isHorizontal  = Math.abs(g.dx) > Math.abs(g.dy) * 1.6
        const hasMoved      = Math.abs(g.dx) > 12
        return (fromLeftEdge || fromRightEdge) && isHorizontal && hasMoved
      },

      // Feedback visual: o ecrã acompanha ligeiramente o dedo
      onPanResponderMove: (_, g) => {
        if (!active.current) active.current = true
        // Resistência: 35% do movimento real para dar sensação de peso
        translateX.setValue(g.dx * 0.35)
      },

      onPanResponderRelease: (_, g) => {
        active.current = false
        const goNext = g.dx < -THRESHOLD || (g.dx < -25 && g.vx < -VELOCITY)
        const goPrev = g.dx >  THRESHOLD || (g.dx >  25 && g.vx >  VELOCITY)

        if (goNext && currentIndex < TABS.length - 1) {
          // Slide para fora à esquerda, depois navega
          Animated.timing(translateX, {
            toValue: -W * 0.08,
            duration: 140,
            useNativeDriver: true,
          }).start(() => {
            translateX.setValue(0)
            router.navigate(TABS[currentIndex + 1] as any)
          })
        } else if (goPrev && currentIndex > 0) {
          // Slide para fora à direita, depois navega
          Animated.timing(translateX, {
            toValue: W * 0.08,
            duration: 140,
            useNativeDriver: true,
          }).start(() => {
            translateX.setValue(0)
            router.navigate(TABS[currentIndex - 1] as any)
          })
        } else {
          // Snap de volta à posição original
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 80,
            friction: 10,
          }).start()
        }
      },

      onPanResponderTerminate: () => {
        active.current = false
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }).start()
      },
    })
  ).current

  return { panHandlers: panResponder.panHandlers, translateX }
}
