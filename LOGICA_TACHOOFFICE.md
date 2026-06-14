# TachoOffice — Lógica Central

> Documento de referência. Se perderes o código, este ficheiro permite reconstruir
> toda a lógica das duas partes críticas da app: cronómetro de condução e estimativas salariais.

---

## PARTE 1 — CRONÓMETRO DE CONDUÇÃO

### 1.1 Contadores em jogo (todos em segundos)

| Variável | O que conta | Regra |
|---|---|---|
| `segServico` | Tempo de serviço activo (sem pausas) | Conta enquanto `enService && !emPausa` |
| `segConducao` | Condução no ciclo actual (reset na pausa válida) | Conta enquanto `enService && !emPausa && emConducao` |
| `segConducaoDiario` | Condução acumulada no dia (soma dos ciclos) | Soma quando `segConducao` é resetado |
| `segAmplitude` | Amplitude total do dia (inclui pausas) | Conta sempre que `enService` (mesmo em pausa) |
| `segPausa` | Duração da pausa actual | Conta enquanto `emPausa` |
| `segPausaTotal` | Soma de todas as pausas do dia | Acumulativo |

```
segConducaoHoje = segConducaoDiario + segConducao
```

### 1.2 Limites legais (Regulamento CE 561/2006)

```ts
// src/constants.ts
PAUSA_MAX       = 4.5 * 3600   // 4h30 máx por ciclo sem pausa
MAX_CONDUITE    = 9 * 3600     // 9h máx de condução por dia
MAX_SERVICE     = modeNuit ? 10 * 3600 : 12 * 3600   // serviço máx
MAX_AMPLITUDE   = modeNuit ? 13 * 3600 : 15 * 3600   // amplitude máx
```

### 1.3 Detecção automática de condução via GPS

**Fonte de verdade:** velocidade GPS + acelerómetro como fallback.

**Pipeline de filtragem (anti-spike):**

```
Velocidade GPS bruta
  → Buffer mediana (últimos 7 valores) → velMedia
  → Filtro de aceleração (salto > 15 km/h a partir de 0 = spike GPS → ignorar)
  → Filtro GPS congelado (mesma velocidade ±2 km/h por 4s+ = sinal congelado)
  → Filtro GPS mentiroso (velGps > 20 km/h mas inferida < 5 km/h por 5s+)
```

**Arranque da condução:**
- Velocidade >= 8 km/h durante **10 segundos** consecutivos → `emConducao = true`
- *(era 15s — reduzido para arranque mais rápido sem falsos arranques)*

**Paragem da condução** (o mais sensível que dispara primeiro):
```
< 3 km/h durante 8s   → PARA
< 5 km/h durante 16s  → PARA
< 7 km/h durante 28s  → PARA
GPS congelado (4s)    → PARA
GPS mentiroso (5s)    → PARA
```

**Constantes em `src/constants.ts`:**
```ts
VELOCIDADE_MIN             = 8      // km/h mínimo para contar condução
CONDUCAO_SEGUNDOS_ON       = 10     // segundos acima de VELOCIDADE_MIN para arrancar (era 15)
CONDUCAO_PARAR_ABAIXO_3_S = 8      // segundos < 3 km/h para parar
CONDUCAO_PARAR_ABAIXO_5_S = 16
CONDUCAO_PARAR_ABAIXO_7_S = 28
VEL_BUFFER_SIZE            = 7      // tamanho do buffer de mediana
ACCEL_SALTO_MAX_KMH        = 15     // salto máximo de velocidade num tick GPS
GPS_MOVIMENTO_SALTO_MAX_KM = 1      // distância máxima normal entre ticks GPS
GPS_MOVIMENTO_GAP_S        = 30     // gap longo — aceita até 50 km
GPS_MOVIMENTO_GAP_MAX_KM   = 50
```

### 1.4 Recuperação de background

Quando a app vai para background, guarda `lastBgTick = Date.now()`.
Ao voltar ao foreground: `tempoBackground = (Date.now() - lastBgTick) / 1000`.

```ts
// Distribui o tempo de background pelos contadores certos
if (emPausa) {
  segPausa      += tempoBackground
  segPausaTotal += tempoBackground
  segAmplitude  += tempoBackground
} else if (emConducao) {
  segConducao   += tempoBackground
  segAmplitude  += tempoBackground
  segServico    += tempoBackground
} else {
  segAmplitude  += tempoBackground
  segServico    += tempoBackground
}
```

### 1.5 Lógica de pausa (CE 561/2006)

**Pausa válida = reset de `segConducao`** se uma destas condições for verdade:
1. Uma pausa única ≥ 45 minutos
2. Sequência de duas pausas: primeira ≥ 15 min, depois ≥ 30 min (nesta ordem)

```ts
const pausaSequenciaValida = (lista: {dur, inicio}[]): boolean => {
  let found15 = false
  for (const p of lista) {
    if (!found15 && p.dur >= 15 * 60) { found15 = true; continue }
    if (found15  && p.dur >= 30 * 60) return true
  }
  return false
}
```

Ao **retomar** após pausa:
- Se pausa válida → `segConducaoDiario += segConducao`, `segConducao = 0`
- Se pausa inválida → `segConducao` continua de onde estava

### 1.6 Alertas progressivos de pausa

```ts
warnPhase = segConducao >= 4h30        ? 3  // LIMITE — pausa obrigatória
          : segConducao >= 4h15        ? 2  // Aviso crítico
          : segConducao >= 4h10        ? 1  // Aviso inicial
          : 0
```

Alerta de 9h diárias: aviso 15 minutos antes do limite.
Alerta de amplitude: se `segAmplitude >= 16h` → "esqueceste de terminar o serviço?"

---

## PARTE 2 — CÁLCULO DE FRAIS (por dia)

### 2.1 Regras de atribuição (`src/frais.ts`)

**Dias sem frais:** `OFF, RC, FERIE, FER, vac, CONGE, FERIADO, hol`
**Dias com frais:** `TRAB, DEC, work, dec`

| Componente | Condição de atribuição |
|---|---|
| **Petit-déjeuner (PTD)** | Início de serviço ≤ `ptDejAte` horas (padrão 06h00) **OU** dia anterior foi découché |
| **Déjeuner (DEJ)** | Amplitude efectiva ≥ `dejMinAmp` horas (padrão 6h01) **OU** découché |
| **Dîner (DIN)** | Apenas se découché |
| **Nuit (NUI)** | Apenas se découché |

**Valores padrão (genéricos — aprendidos dos boletins de frais reais):**
```
PTD = 4.42 €   DEJ = 16.36 €   DIN = 23.94 €   NUI = 23.94 €
```

**Regras padrão (aprendidas dos boletins):**
```
ptDejAte   = 6.0    (início ≤ 06h00 → tem PTD)
dejMinAmp  = 6.017  (amplitude ≥ 6h01 → tem DEJ)
dinerDe    = 21.25  (fim ≥ 21h15 → tem DIN, mas só para TRAB; DEC tem sempre)
```

### 2.2 Cálculo por mês (calcFraisMesPorHorarios)

Para cada dia do mês de frais no calendário:
1. Determina tipo (TRAB/DEC), hora início, hora fim, segServico, segPausa
2. Chama `calcularFraisJour(...)` → devolve `{ptd, dej, din, nui, total}`
3. Soma tudo → total frais do mês

**Prioridade na fonte dos frais:**
```
1. fraisRecuConfirme (utilizador confirmou valor real recebido)
2. fraisBoletim (lido pelo AI do boletim de frais)
3. calcFraisMesPorHorarios × fraisFactorReal (cálculo automático corrigido)
4. calcFraisMesPorHorarios × 1 (cálculo puro sem correcção)
```

---

## PARTE 3 — ESTIMATIVA SALARIAL (fiche.tsx)

### 3.1 O objecto Padrao — cérebro da estimativa

Tudo o que a app aprende fica guardado no `padrao` (AsyncStorage: **`'monSalaire_padrao'`**).

```ts
type Padrao = {
  // Configuração base (onboarding obrigatório)
  hval: number          // taxa horária bruta (€/h)
  hbase: number         // horas base contratuais por mês
  h25: number           // taxa hora extra +25%
  h50: number           // taxa hora extra +50%
  lim25: number         // limite de horas para +25% antes de passar a +50%

  // Desfasamentos (aprendidos das fiches)
  hlag: number          // meses entre trabalho e recebimento do salário (padrão 1)
  flag: number          // meses entre trabalho e recebimento dos frais (padrão 1)

  // Cotisações (aprendido das fiches com bruto + líquido)
  liquidRate: number    // ratio líquido/bruto (padrão 0.79 = 79%)

  // Frais (aprendidos dos boletins)
  ptd: number; dej: number; din: number; nui: number
  regles: { ptDejAte, dejMinAmp, dinerDe }
  fraisFactorReal: number   // factor de correcção boletim vs cálculo

  // Dias especiais (aprendidos das fiches)
  valorDiaConges: number    // valor € por dia de congé pago
  valorDiaFerie: number     // valor € por dia feriado
  valorDiaRC: number        // valor € por dia recuperação compensatória

  // Modo calibrado (aprendido de meses com histórico confirmado)
  taxaHorariaNetaMedia: number   // taxa horária neta efectiva (€/h líquido)
  horasExtrasMedia: number       // média de horas extras quando congés = 0

  // Dias de pagamento
  diaSalario: number    // dia do mês em que recebe o salário (padrão 5)
  diaFrais: number      // dia do mês em que recebe os frais (padrão 10)

  // Protecção contra extracção errada de hbase pela IA
  _conflitHbase?: { extraido: number; onboarding: number } | null
  // Guardado quando IA extrai hbase >4% diferente do onboarding
  // Não substitui automaticamente — apresenta alerta ao utilizador para escolher
}
```

### 3.2 Desfasamentos temporais (hlag / flag)

O salário de trabalho de **Março** pode ser pago em **Abril** (hlag=1) ou **Maio** (hlag=2).
Os frais de trabalho de **Março** podem ser pagos em **Abril** (flag=1) ou **Maio** (flag=2).

```
Mês actual: Maio
  → mesReceber  = Junho (se dia actual > diaSalario)
  → mesHoras    = mesReceber - hlag   (mês cujo trabalho vai ser pago)
  → mesFrais    = mesReceber - flag   (mês cujos frais vão ser pagos)
```

**Aprendizagem do hlag:**
- Compara data da fiche (mês de pagamento) com o mês de trabalho inferido
- Vota nos lags possíveis e escolhe o mais frequente

**Aprendizagem do flag:**
- Compara data do boletim de frais com o mês de trabalho correspondente
- Testa também `calcFraisMesPorHorarios` para cada lag candidato

### 3.3 Três modos de cálculo do salário líquido

#### MODO PRECISO (fiche confirmada)
```
salLiq = ficheReal.netPaye      // valor real extraído/confirmado da fiche
salBrut = ficheReal.salairebrut || salLiq / liquidRate
```

#### MODO CALIBRADO (taxaHorariaNetaMedia > 0)
```
// Taxa neta efectiva aprende a relação horas→líquido directamente
// sem precisar de separar bruto, cotisações e dias especiais
salLiq = totalH × taxaHorariaNetaMedia
       + nConges × valorDiaConges × liquidRate
       + nFeries × valorDiaFerie × liquidRate
       + nRC     × valorDiaRC    × liquidRate
salBrut = salLiq / liquidRate
```

#### MODO ESTIMADO (fallback clássico)
```
// Fase 1: calcular bruto
if totalH <= hbase:
  salBrut = totalH × hval
else:
  extra   = totalH - hbase
  hExtra25 = min(extra, lim25)
  hExtra50 = max(0, extra - lim25)
  salBrut = hbase × hval + hExtra25 × h25 + hExtra50 × h50

// Adicionar dias especiais ao bruto
salBrut += nConges × valorDiaConges (ou hbase/22 × hval se não aprendido)
salBrut += nFeries × valorDiaFerie
salBrut += nRC     × valorDiaRC

// Fase 2: bruto → líquido
salLiq = salBrut × liquidRate
```

### 3.4 Aprendizagem automática do padrao

Cada vez que o utilizador carrega fiches/boletins confirmados, a função
`aprendeNovosPadroes(dados, hist, base)` recalibra o padrao:

**A. liquidRate** — precisa de fiche com bruto + líquido:
```
taxa = netPaye / salairebrut
liquidRate = média das taxas de todos os meses confirmados
```

**B. valorDiaConges/Ferie/RC** — precisa de fiche com dias especiais e montantes:
```
valorDiaConges = média(montantConges / joursConges) nos meses com dados
```

**C. Regras de frais** — optimização exaustiva por grid search:
```
Testa todas as combinações de (ptDejAte, dejMinAmp, dinerDe)
Escolhe a que minimiza o erro médio vs boletins confirmados
```

**D. fraisFactorReal** — correcção global dos frais:
```
fraisFactorReal = média(fraisBoletim / fraisCalculo) nos meses com boletim
```

**E. taxaHorariaNetaMedia** — aprendida de meses sem congés (mais limpos):
```
// Para cada mês com salário confirmado e sem congés:
taxaNeta = (netPaye - nConges×valCongeNet - nFeries×valFerieNet - nRC×valRCNet) / totalH
taxaHorariaNetaMedia = média de todas as taxas
```

**G. hbase** — protecção contra extracção errada pela IA (3 camadas):
```
Camada 1 — Prompt melhorado:
  IA instruída a ler coluna "Base" da linha "Sous total Salaire de base"
  NÃO usar horas anuais do recapitulatif (ex: 1892h → 1892÷12=157.67 é ARMADILHA)

Camada 2 — Filtro armadilha (em aprendeNovosPadroes):
  Valores conhecidos como anuais÷12 são descartados silenciosamente:
  157.67 (1892÷12), 151.67 (1820÷12), 133.92 (1607÷12)

Camada 3 — Detecção de conflito:
  Se hbase extraído difere >4% do valor de onboarding:
    → NÃO substitui automaticamente
    → Guarda _conflitHbase = { extraido, onboarding }
    → Painel Analyse mostra alerta com dois botões para o utilizador escolher

Aviso adicional no painel (hbase já guardado errado):
  Se padrao.hbase é um valor armadilha conhecido → indicador 🟠 + botão "Corriger"
  Modal com campo de texto para o utilizador escrever o valor correcto
```

**F. hlag e flag** — por votação:
```
Para cada mês com salário confirmado:
  hlag_candidato = mês_pagamento - mês_trabalho
  votação → escolhe o lag mais frequente com protecção (muda só com ≥2 votos)
```

### 3.5 Precisão da estimativa

**Cálculo real (quando há ≥ 2 meses confirmados):**
```
Para cada mês com montantTotalRecu confirmado:
  erro = |estimativa - real|
  score = erro ≤ 30€  → 100%
          erro ≤ 70€  → 98%
          erro ≤ 120€ → 95%
          erro ≤ 200€ → 88%
          outro        → max(60, 100 - erro/real×100)

precisao = média dos scores
```

**Fallback (quando há < 2 meses confirmados):**
```
precisao = 40%
         + min(nMeses × 15%, 45%)  // +15% por mês de dados
         + 10% se tem découché aprendido
         + 5%  se liquidRate não é o default (0.79)
```

### 3.6 Detecção de drift (mudanças da empresa)

Analisa os últimos 3-4 meses confirmados. Se o erro for **sempre na mesma direcção** com média > 5%:

```
erro_i = (estimativa_i - real_i) / real_i × 100

Se todos os erros > 0 ou todos < 0  →  drift detectado
Tipo:
  mediaSal  > 7% e mediaFrais < 3%  →  "salaire" (cotisações mudaram)
  mediaFrais > 7% e mediaSal  < 3%  →  "frais"   (regras empresa mudaram)
  ambos                             →  "misto"
```

A app mostra alerta no painel Analyse com mensagem específica por tipo.

---

## PARTE 4 — CÁLCULO DE FRAIS POR HORÁRIOS (calcFraisMesPorHorarios)

Usa os dias do calendário (`historique` diário) para recalcular o boletim de frais:

```
Para cada dia do mês (do calendário):
  1. Determina tipo: TRAB ou DEC
  2. Lê debut, fin, segServico, segPausa
  3. Verifica se dia anterior foi DEC (→ dá PTD)
  4. Chama calcularFraisJour({type, debut, fin, segServico, segPausa, prevDecouche, regles, valeurs})
  5. Soma: ptd_total, dej_total, din_total, nui_total, total_frais

Resultado aplicado com factor de correcção:
  totalFrais = total_frais × fraisFactorReal  (se fraisFactorReal > 0.1)
```

---

## PARTE 5 — ESTRUTURA DE DADOS

### Jour (calendário diário — AsyncStorage: `'historique'`)
```ts
{
  id: string           // timestamp ms
  date: "DD/MM"
  jour: "Lun"|"Mar"...
  type: "TRAB"|"DEC"|"OFF"|"RC"|"FERIE"|"FER"|"vac"
  debut: "05h30"       // hora início serviço
  fin:   "17h45"       // hora fim serviço
  segServico: number   // segundos de serviço efectivo
  segPausa:   number   // segundos de pausa total no dia
  decouche:   boolean
  frais:      number   // total frais calculado no dia
  kmDiarios:  number
  modeNuit:   boolean
}
```

### MoisData (fiches mensais — AsyncStorage: `'historique_salaires'`)
```ts
{
  periode:          string    // "Janvier 2026"
  moisIndex:        number    // 0-11
  annee:            number
  netPaye:          number    // salário líquido real
  salairebrut:      number    // salário bruto real
  fraisBoletim:     number    // frais do boletim
  fraisRecuConfirme: number   // frais confirmado pelo utilizador
  montantTotalRecu: number    // total recebido (sal + frais)
  joursConges:      number    // dias de congé pago
  montantConges:    number    // valor dos congés
  joursFeries:      number
  joursRC:          number
  salarioConfirmado: boolean  // utilizador confirmou o valor real
  estimativaSnapshot: number  // estimativa da app NO MOMENTO da confirmação
  // Desfasamentos aprendidos
  mesFraisTrabalhoIndex: number
  anoFraisTrabalho:      number
  mesPagamentoIndex:     number
  anoPagamento:          number
}
```

---

## RESUMO — O QUE TORNA ESTA APP DIFERENTE

| Funcionalidade | App genérica | TachoOffice |
|---|---|---|
| Cálculo de frais por dia | ❌ | ✅ PTD/DEJ/DIN/NUI por tipo |
| Aprendizagem das regras da empresa | ❌ | ✅ grid search em boletins reais |
| Taxa de cotisações real | ❌ 79% fixo | ✅ aprendida das fiches |
| Desfasamento temporal salário/frais | ❌ ignora | ✅ hlag/flag aprendidos |
| Modo calibrado (taxa neta média) | ❌ | ✅ aprende de histórico confirmado |
| Detecção de deriva (empresa mudou) | ❌ | ✅ análise de drift nos últimos meses |
| Condução automática via GPS | ❌ | ✅ mediana + 5 filtros anti-spike |
| Recuperação de background | ❌ | ✅ distribui tempo pelos contadores |
| Painel de transparência de cálculo | ❌ | ✅ Détail du calcul + Données essentielles (🔴🟡🟢) |
| Protecção contra hbase errado pela IA | ❌ | ✅ 3 camadas: prompt + armadilha + conflito |
| Detecção de mudança de parâmetros | ❌ | ✅ editável em Réglages + aviso se valor suspeito |
