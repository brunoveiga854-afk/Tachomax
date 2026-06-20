import { Tabs } from 'expo-router'
import { useTheme } from '../../context/ThemeContext'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']
type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name']

function TabIcon({
  focused,
  children,
}: {
  focused: boolean
  children: React.ReactNode
}) {
  return (
    <View style={{
      alignItems: 'center',
      justifyContent: 'center',
      width: 44,
      height: 44,
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
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen name="index" options={{
        title: "Aujourd'hui",
        tabBarIcon: ({ focused }) => (
          <TabIcon focused={focused}>
            <MaterialCommunityIcons
              name={'truck' as MCIName}
              size={26}
              color={focused ? activeColor : inactiveColor}
            />
          </TabIcon>
        ),
      }} />
      <Tabs.Screen name="historique" options={{
        title: 'Historique',
        tabBarIcon: ({ focused }) => (
          <TabIcon focused={focused}>
            <Ionicons
              name={(focused ? 'calendar' : 'calendar-outline') as IoniconsName}
              size={24}
              color={focused ? activeColor : inactiveColor}
            />
          </TabIcon>
        ),
      }} />
      <Tabs.Screen name="fiche" options={{
        title: 'Mon Salaire',
        tabBarIcon: ({ focused }) => (
          <TabIcon focused={focused}>
            <Ionicons
              name={(focused ? 'wallet' : 'wallet-outline') as IoniconsName}
              size={24}
              color={focused ? activeColor : inactiveColor}
            />
          </TabIcon>
        ),
      }} />
      <Tabs.Screen name="reglages" options={{
        title: 'Réglages',
        tabBarIcon: ({ focused }) => (
          <TabIcon focused={focused}>
            <Ionicons
              name={(focused ? 'settings' : 'settings-outline') as IoniconsName}
              size={24}
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