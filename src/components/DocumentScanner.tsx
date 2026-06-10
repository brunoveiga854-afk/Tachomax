import React, { useRef, useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, Animated,
  Dimensions, Vibration, StyleSheet, StatusBar,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { Accelerometer } from 'expo-sensors'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const FRAME_W = SCREEN_W * 0.80
const FRAME_H = FRAME_W * Math.SQRT2  // A4 portrait ratio 1:√2
const FRAME_X = (SCREEN_W - FRAME_W) / 2
const FRAME_Y = (SCREEN_H - FRAME_H) / 2

const CORNER = 30      // px per arm of each L-marker
const THICK = 3        // px thickness
const STABLE_MS = 2000 // ms of stillness before green
const DELTA_THRESHOLD = 0.03

interface Props {
  onCapture: (uri: string) => void
  onClose: () => void
}

export default function DocumentScanner({ onCapture, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  const [stable, setStable] = useState(false)
  const stableTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevAccel = useRef({ x: 0, y: 0, z: 0 })
  const colorAnim = useRef(new Animated.Value(0)).current

  // Request camera permission on mount
  useEffect(() => {
    if (permission && !permission.granted) requestPermission()
  }, [permission])

  // Animate corner color and vibrate when stability state changes
  useEffect(() => {
    Animated.timing(colorAnim, {
      toValue: stable ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start()
    if (stable) Vibration.vibrate(50)
  }, [stable])

  // Accelerometer-based stability detection
  useEffect(() => {
    Accelerometer.setUpdateInterval(200)
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const p = prevAccel.current
      const delta = Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.z) ** 2)
      prevAccel.current = { x, y, z }

      if (delta < DELTA_THRESHOLD) {
        if (!stableTimer.current) {
          stableTimer.current = setTimeout(() => setStable(true), STABLE_MS)
        }
      } else {
        if (stableTimer.current) {
          clearTimeout(stableTimer.current)
          stableTimer.current = null
        }
        setStable(false)
      }
    })
    return () => {
      sub.remove()
      if (stableTimer.current) clearTimeout(stableTimer.current)
    }
  }, [])

  const handleCapture = async () => {
    if (!stable || !cameraRef.current) return
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.92 })
      if (photo?.uri) onCapture(photo.uri)
    } catch {}
  }

  const cornerColor = colorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#e74c3c', '#27ae60'],
  })

  if (!permission) return <View style={st.container} />

  if (!permission.granted) {
    return (
      <View style={[st.container, st.center]}>
        <Text style={st.permText}>Accès à la caméra requis pour scanner un document</Text>
        <TouchableOpacity onPress={requestPermission} style={st.permBtn}>
          <Text style={st.permBtnText}>Autoriser la caméra</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={st.permClose}>
          <Text style={st.permBtnText}>Fermer</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const corners: Array<'tl' | 'tr' | 'bl' | 'br'> = ['tl', 'tr', 'bl', 'br']

  return (
    <View style={st.container}>
      <StatusBar hidden />
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      {/* Dark overlay — 4 surrounding strips leaving the document frame clear */}
      <View style={[st.overlay, { height: FRAME_Y }]} />
      <View style={[st.overlay, { top: FRAME_Y + FRAME_H, bottom: 0 }]} />
      <View style={[st.overlay, { top: FRAME_Y, width: FRAME_X, height: FRAME_H }]} />
      <View style={[st.overlay, { top: FRAME_Y, left: FRAME_X + FRAME_W, right: 0, height: FRAME_H }]} />

      {/* Corner L-markers */}
      {corners.map((pos) => {
        const isTop = pos === 'tl' || pos === 'tr'
        const isLeft = pos === 'tl' || pos === 'bl'
        return (
          <View
            key={pos}
            style={{
              position: 'absolute',
              top: isTop ? FRAME_Y : FRAME_Y + FRAME_H - CORNER,
              left: isLeft ? FRAME_X : FRAME_X + FRAME_W - CORNER,
              width: CORNER,
              height: CORNER,
            }}
            pointerEvents="none"
          >
            {/* Horizontal arm */}
            <Animated.View
              style={{
                position: 'absolute',
                top: isTop ? 0 : CORNER - THICK,
                left: 0,
                width: CORNER,
                height: THICK,
                backgroundColor: cornerColor,
              }}
            />
            {/* Vertical arm */}
            <Animated.View
              style={{
                position: 'absolute',
                top: 0,
                left: isLeft ? 0 : CORNER - THICK,
                width: THICK,
                height: CORNER,
                backgroundColor: cornerColor,
              }}
            />
          </View>
        )
      })}

      {/* Close button — top-left */}
      <TouchableOpacity style={st.closeBtn} onPress={onClose}>
        <Text style={st.closeTxt}>✕</Text>
      </TouchableOpacity>

      {/* Hint text above frame */}
      <View style={[st.hintRow, { top: FRAME_Y - 44 }]} pointerEvents="none">
        <Text style={st.hintTxt}>
          {stable
            ? '✅ Stable — prêt à capturer'
            : '📐 Alignez le document et restez immobile 2s'}
        </Text>
      </View>

      {/* Capture button — bottom-center */}
      <View style={st.captureRow}>
        <TouchableOpacity
          onPress={handleCapture}
          disabled={!stable}
          style={[st.captureBtn, { borderColor: stable ? '#f5a623' : '#888' }]}
        >
          <View style={[st.captureBtnInner, { backgroundColor: stable ? '#f5a623' : '#555' }]} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { justifyContent: 'center', alignItems: 'center', padding: 32 },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  closeBtn: {
    position: 'absolute',
    top: 52,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeTxt: { color: 'white', fontSize: 20, fontWeight: '700' },
  hintRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintTxt: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    overflow: 'hidden',
  },
  captureRow: {
    position: 'absolute',
    bottom: 52,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBtnInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  permText: {
    color: 'white',
    textAlign: 'center',
    marginBottom: 28,
    fontSize: 15,
    lineHeight: 22,
  },
  permBtn: {
    backgroundColor: '#f5a623',
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  permClose: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#555',
    width: '100%',
    alignItems: 'center',
  },
  permBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },
})
