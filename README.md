# ROUTEMAX 🚛

**L'app du chauffeur professionnel**
React Native + Expo → Google Play

---

## INSTALAÇÃO RÁPIDA

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar em desenvolvimento
npx expo start

# 3. Abrir no telemóvel (Android)
# Instalar Expo Go → ler QR code

# 4. Build para Google Play (quando pronto)
npx eas build --platform android
```

---

## ESTRUTURA DO PROJECTO

```
src/
├── engine/          ← Motor de cálculo (core)
│   ├── frais.ts     ← Cálculo frais automáticos
│   ├── limites.ts   ← Regras legais + alertas
│   └── feriados.ts  ← Fériados França 2024-2026
│
├── stores/          ← Estado global (Zustand)
│   ├── serviceStore.ts   ← Serviço diário
│   └── profileStore.ts   ← Perfil + trial
│
├── i18n/            ← Traduções FR/PT
└── theme/           ← Design system
```

---

## ESTADO ACTUAL (v0.1)

### ✅ Feito
- [x] Estrutura completa do projecto
- [x] Motor de frais (cálculo por horário)
- [x] Motor de limites legais (alertas)
- [x] Store de serviço diário (Zustand + AsyncStorage)
- [x] Store de perfil + trial 60 dias
- [x] Fériados França 2024-2026
- [x] Traduções FR + PT
- [x] Design system (claro/escuro)
- [x] Ecrã principal (timer + botões)

### 🔄 A fazer
- [ ] Ecrã de onboarding (perfil)
- [ ] Ecrã histórico semanal
- [ ] Ecrã fiche de paye (upload + IA)
- [ ] Relatório mensal (exportar PDF)
- [ ] Notificações push (pausa obrigatória)
- [ ] Sistema de trial (paywall 60 dias)
- [ ] Integração leitor Bluetooth tacógrafo
- [ ] Submissão Google Play

---

## MODELO DE NEGÓCIO

- **Download:** Gratuito
- **Trial:** 60 dias — 100% das funcionalidades
- **Premium:** 2,99€/mês após trial
- **Afiliação:** Leitores de cartão tacógrafo

---

## MERCADO ALVO

- Chauffeurs por conta de outrem em França
- Perfis: Courte Distance / Mixte / Longue Distance
- v2.0: Luxemburgo + Bélgica

---

## TECNOLOGIA

| | Escolha | Porquê |
|---|---|---|
| Framework | React Native + Expo | Cross-platform, familiar |
| Estado | Zustand | Simples, performante |
| Storage | AsyncStorage | Offline first |
| Navegação | Expo Router | File-based routing |
| IA (fiche) | Anthropic API (cloud) | App leve no telemóvel |
| Build | EAS Build | Google Play directo |
