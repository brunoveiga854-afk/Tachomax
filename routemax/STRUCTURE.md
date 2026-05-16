# ROUTEMAX — Estrutura do Projecto

routemax/
├── app/                          # Expo Router — ecrãs
│   ├── (tabs)/
│   │   ├── index.tsx             # Ecrã principal (Aujourd'hui)
│   │   ├── historique.tsx        # Histórico semanal/mensal
│   │   ├── fiche.tsx             # Fiche de paye + frais upload
│   │   └── reglages.tsx          # Configurações
│   ├── onboarding/
│   │   ├── index.tsx             # Bem-vindo
│   │   ├── profil.tsx            # Escolha perfil CD/Mixte/LD
│   │   └── setup.tsx             # Upload fiche + frais
│   └── _layout.tsx               # Layout raiz + tema
│
├── src/
│   ├── stores/                   # Zustand — estado global
│   │   ├── serviceStore.ts       # Estado do serviço diário
│   │   ├── profileStore.ts       # Perfil do chauffeur
│   │   ├── ficheStore.ts         # Dados da fiche de paye
│   │   └── trialStore.ts         # Gestão do trial 60 dias
│   │
│   ├── engine/                   # Motor de cálculo — core da app
│   │   ├── frais.ts              # Cálculo frais por horário
│   │   ├── limites.ts            # Regras legais e alertas
│   │   ├── amplitude.ts          # Cálculo amplitude
│   │   ├── nuit.ts               # Regras trabalho nocturno
│   │   ├── salaire.ts            # Estimativa salarial
│   │   └── feriados.ts           # Fériados França 2024-2026
│   │
│   ├── ia/                       # Integração IA (cloud)
│   │   ├── readFiche.ts          # Leitura fiche de paye
│   │   └── readFrais.ts          # Leitura documento frais
│   │
│   ├── components/               # Componentes reutilizáveis
│   │   ├── Timer.tsx             # Cronómetro principal
│   │   ├── LimitBar.tsx          # Barra de limite legal
│   │   ├── DayTypeSelector.tsx   # Trab/Dec/Fér/Fer/RC/Off
│   │   ├── DecocheToggle.tsx     # Toggle découché
│   │   ├── AlertBanner.tsx       # Alertas amarelo/vermelho
│   │   └── MonthReport.tsx       # Relatório mensal
│   │
│   ├── i18n/                     # Traduções
│   │   ├── fr.ts                 # Francês
│   │   └── pt.ts                 # Português
│   │
│   ├── theme/                    # Design system
│   │   ├── colors.ts             # Cores claro/escuro
│   │   ├── typography.ts         # Fontes e tamanhos
│   │   └── spacing.ts            # Espaçamentos
│   │
│   └── utils/
│       ├── storage.ts            # AsyncStorage helpers
│       ├── notifications.ts      # Push notifications
│       └── date.ts               # Helpers de data/hora
│
├── assets/
│   ├── icon.png
│   └── splash.png
│
├── app.json                      # Config Expo
└── tsconfig.json                 # TypeScript config
