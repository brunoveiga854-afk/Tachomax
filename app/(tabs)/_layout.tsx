import { Tabs } from 'expo-router'
import { useTheme } from '../../context/ThemeContext'
import { View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']
type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name']

function TabIcon({
  focused,
  children,
  sc,
}: {
  focused: boolean
  children: React.ReactNode
  sc: number
}) {
  const sz = Math.round(44 * sc)
  return (
    <View style={{
      alignItems: 'center',
      justifyContent: 'center',
      width: sz,
      height: sz,
      borderRadius: 12,
      backgroundColor: focused ? 'rgba(245,166,35,0.18)' : 'transparent',
    }}>
      {children}
    </View>
  )
}

export default function TabsLayout() {
  const { themeSombre } = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const sc = Math.min(Math.max(width / 375, 0.85), 1.15)

  const activeColor = '#f5a623'
  const inactiveColor = themeSombre ? '#3a4060' : '#b0b8d0'

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: themeSombre ? '#181c27' : '#ffffff',
          borderTopWidth: 0,
          borderTopColor: themeSombre ? '#1e2438' : '#e8ecf5',
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom + 4,
          paddingTop: 6,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: themeSombre ? 0.4 : 0.08,
          shadowRadius: 8,
        },
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarLabelStyle: { fontSize: Math.round(10 * sc), fontWeight: '700', letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen name="index" options={{
        title: "Aujourd'hui",
        tabBarIcon: ({ focused }) => (
          <TabIcon focused={focused} sc={sc}>
            <MaterialCommunityIcons
              name={'truck' as MCIName}
              size={Math.round(26 * sc)}
              color={focused ? activeColor : inactiveColor}
            />
          </TabIcon>
        ),
      }} />
      <Tabs.Screen name="historique" options={{
        title: 'Historique',
        tabBarIcon: ({ focused }) => (
          <TabIcon focused={focused} sc={sc}>
            <Ionicons
              name={(focused ? 'calendar' : 'calendar-outline') as IoniconsName}
              size={Math.round(24 * sc)}
              color={focused ? activeColor : inactiveColor}
            />
          </TabIcon>
        ),
      }} />
      <Tabs.Screen name="fiche" options={{
        title: 'Mon Salaire',
        tabBarIcon: ({ focused }) => (
          <TabIcon focused={focused} sc={sc}>
            <Ionicons
              name={(focused ? 'wallet' : 'wallet-outline') as IoniconsName}
              size={Math.round(24 * sc)}
              color={focused ? activeColor : inactiveColor}
            />
          </TabIcon>
        ),
      }} />
      <Tabs.Screen name="reglages" options={{
        title: 'Réglages',
        tabBarIcon: ({ focused }) => (
          <TabIcon focused={focused} sc={sc}>
            <Ionicons
              name={(focused ? 'settings' : 'settings-outline') as IoniconsName}
              size={Math.round(24 * sc)}
              color={focused ? activeColor : inactiveColor}
            />
          </TabIcon>
        ),
      }} />
      <Tabs.Screen name="onboarding" options={{ href: null }} />
      <Tabs.Screen name="ThemeProvider" options={{ href: null }} />
      <Tabs.Screen name="LangueContext" options={{ href: null }} />
      <Tabs.Screen name="ThemeContext" options={{ href: null }} />
    </Tabs>
  )
}