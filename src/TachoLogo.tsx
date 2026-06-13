import React from 'react'
import { View, Text } from 'react-native'
import Svg, { Circle, Line, G } from 'react-native-svg'

// Speedometer/tachometer gauge icon — matches the app logo
function GaugeIcon({ size = 34, color = '#f5a623' }: { size?: number; color?: string }) {
  const cx = size / 2
  const cy = size / 2
  const outerR = size / 2 - size * 0.08
  const sw = size * 0.075   // stroke width

  // Tick marks: 8 major positions around the face (every 45°)
  const ticks = [0, 45, 90, 135, 180, 225, 270, 315]
  const tickOuter = outerR
  const tickInner = outerR * 0.72

  // Needle: pointing to ~50° from 12 o'clock (1–2 o'clock, like medium revs)
  const needleDeg = 50
  const needleRad = (needleDeg - 90) * (Math.PI / 180)
  const needleLen = outerR * 0.60
  const nx = cx + Math.cos(needleRad) * needleLen
  const ny = cy + Math.sin(needleRad) * needleLen

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Outer ring */}
      <Circle cx={cx} cy={cy} r={outerR} stroke={color} strokeWidth={sw} fill="none" />

      {/* Tick marks */}
      {ticks.map(deg => {
        const rad = (deg - 90) * (Math.PI / 180)
        const x1 = cx + Math.cos(rad) * tickOuter
        const y1 = cy + Math.sin(rad) * tickOuter
        const x2 = cx + Math.cos(rad) * tickInner
        const y2 = cy + Math.sin(rad) * tickInner
        return (
          <Line
            key={deg}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={color}
            strokeWidth={sw * 0.9}
            strokeLinecap="round"
          />
        )
      })}

      {/* Needle */}
      <Line
        x1={cx} y1={cy}
        x2={nx} y2={ny}
        stroke={color}
        strokeWidth={sw * 1.2}
        strokeLinecap="round"
      />

      {/* Centre dot */}
      <Circle cx={cx} cy={cy} r={sw * 0.9} fill={color} />
    </Svg>
  )
}

// Full logo row:  TACH [gauge] OFFICE
export function TachoLogo({ textColor = '#ffffff', size = 28 }: { textColor?: string; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 0 }}>
      <Text style={{ fontSize: size, fontWeight: '800', color: textColor, letterSpacing: 1 }}>
        TACH
      </Text>
      <GaugeIcon size={size * 1.15} color="#f5a623" />
      <Text style={{ fontSize: size, fontWeight: '800', color: '#f5a623', letterSpacing: 1 }}>
        OFFICE
      </Text>
    </View>
  )
}
