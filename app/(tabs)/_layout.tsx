import { Tabs } from 'expo-router'
import { useTheme } from '../../context/ThemeContext'
import { Text, View } from 'react-native'

export default function TabsLayout() {
  const { themeSombre } = useTheme()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: themeSombre ? '#181c27' : '#ffffff',
          borderTopColor: themeSombre ? '#2a3045' : '#d0d5e8',
          borderTopWidth: 0,
          height: 100,
          paddingBottom: 4,
          paddingTop: 2,
          elevation: 0,
        },
        tabBarActiveTintColor: '#f5a623',
        tabBarInactiveTintColor: themeSombre ? '#3a4060' : '#c0c5d8',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen name="index" options={{
        title: "Aujourd'hui",
        tabBarIcon: ({ focused }) => (
          <View style={{ alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 18, backgroundColor: focused ? 'rgba(245,166,35,0.15)' : 'transparent' }}>
            <Text style={{ fontSize: 22 }}>🚛</Text>
          </View>
        ),
      }} />
      <Tabs.Screen name="historique" options={{
        title: 'Historique',
        tabBarIcon: ({ focused }) => (
          <View style={{ alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 18, backgroundColor: focused ? 'rgba(245,166,35,0.15)' : 'transparent' }}>
            <Text style={{ fontSize: 22 }}>🗂️</Text>
          </View>
        ),
      }} />
      <Tabs.Screen name="fiche" options={{
        title: 'Mon Salaire',
        tabBarIcon: ({ focused }) => (
          <View style={{ alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 18, backgroundColor: focused ? 'rgba(245,166,35,0.15)' : 'transparent' }}>
            <Text style={{ fontSize: 22 }}>💰</Text>
          </View>
        ),
      }} />
      <Tabs.Screen name="reglages" options={{
        title: 'Réglages',
        tabBarIcon: ({ focused }) => (
          <View style={{ alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 18, backgroundColor: focused ? 'rgba(245,166,35,0.15)' : 'transparent' }}>
            <Text style={{ fontSize: 22 }}>⚙️</Text>
          </View>
        ),
      }} />
      <Tabs.Screen name="onboarding" options={{ href: null }} />
      <Tabs.Screen name="ThemeProvider" options={{ href: null }} />
      <Tabs.Screen name="LangueContext" options={{ href: null }} />
      <Tabs.Screen name="ThemeContext" options={{ href: null }} />
    </Tabs>
  )
}