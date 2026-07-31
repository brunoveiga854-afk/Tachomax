import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

type Props = { children: React.ReactNode }
type State = { hasError: boolean; error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Podes ligar aqui a um serviço de logging futuro
    console.error('[ErrorBoundary]', error.message, info.componentStack)
  }

  reset = () => this.setState({ hasError: false, error: null })

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <View style={s.container}>
        <Text style={s.emoji}>⚠️</Text>
        <Text style={s.title}>Quelque chose s'est mal passé</Text>
        <Text style={s.sub}>
          {this.state.error?.message ?? 'Erreur inattendue'}
        </Text>
        <TouchableOpacity style={s.btn} onPress={this.reset}>
          <Text style={s.btnText}>🔄 Réessayer</Text>
        </TouchableOpacity>
      </View>
    )
  }
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1117', alignItems: 'center', justifyContent: 'center', padding: 32 },
  emoji:     { fontSize: 48, marginBottom: 16 },
  title:     { fontSize: 18, fontWeight: '800', color: '#eef0f5', textAlign: 'center', marginBottom: 10 },
  sub:       { fontSize: 13, color: '#6b7394', textAlign: 'center', marginBottom: 32, lineHeight: 20 },
  btn:       { backgroundColor: '#f5a623', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  btnText:   { fontSize: 15, fontWeight: '800', color: '#fff' },
})
