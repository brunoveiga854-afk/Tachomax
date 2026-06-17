// ─────────────────────────────────────────────────────────────────────────────
// src/engine/aprendizagem.ts
// Motor de aprendizagem do TachoOffice
// Aprende padrões salariais a partir de boletins extraídos + respostas do condutor
// ─────────────────────────────────────────────────────────────────────────────

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type PadraoAprendido = {
  hlag: number | null            // meses entre trabalho e recebimento salário
  diaSalario: number | null      // dia do mês que recebe salário
  flag: number | null            // meses entre trabalho e recebimento frais
  diaFrais: number | null        // dia do mês que recebe frais
  hval: number | null            // taxa horária actual
  hEquiv: number                 // heures d'équivalence (fixo 17h)
  tauxEquiv: number | null       // taxa equivalência +25%
  tauxNuit: number | null        // taxa majoração noturna (fixo 2.486€/h)
  liquidRate: number | null      // taxa líquido/bruto média móvel
  liquidRateHistorico: number[]  // últimos 6 meses para média móvel
  diaSalarioConfirmado: boolean
  diaFraisConfirmado: boolean
  hlagConfirmado: boolean
  flagConfirmado: boolean
  primesConhecidas: {
    nome: string
    valor: number
    tipo: 'regular' | 'excepcional'
    mesHabitual?: number
  }[]
  intéressement: {
    valor: number
    tipo: 'anual' | 'pontual'
    mes?: number
  } | null
  versao: number
}

export type BoletimExtraido = {
  periodo: string               // "Mai 2026"
  moisIndex: number             // 0-11
  annee: number
  netPaye: number
  salairebrut: number
  hval: number | null
  heuresSuppl25: number | null
  heuresSuppl50: number | null
  heuresNuit: number | null
  joursCongesN: number | null
  joursCongesN1: number | null
  joursRC: number | null
  fraisBoletim: number | null
  rubriquesDesconhecidas: { nome: string; valor: number }[]
  dataPagamento: Date | null    // data real de pagamento (resposta do condutor)
  mesTrabalho: number | null    // mês de trabalho real (resposta do condutor)
}

export type PerguntaPendente = {
  id: string
  tipo:
    | 'timing_salario'
    | 'timing_frais'
    | 'taxa_mudou'
    | 'prime_desconhecida'
    | 'diferenca'
    | 'dia_diferente'
    | 'interessement'
    | 'liquidrate_anomalo'
  pergunta: string
  opcoes?: string[]
  valorContexto?: any
  boletimRef?: string           // periodo do boletim associado
}

// ─── Valor inicial exportado ──────────────────────────────────────────────────

export const PADRAO_INICIAL: PadraoAprendido = {
  hlag: null,
  diaSalario: null,
  flag: null,
  diaFrais: null,
  hval: null,
  hEquiv: 17,
  tauxEquiv: null,
  tauxNuit: null,
  liquidRate: 0.791,
  liquidRateHistorico: [],
  diaSalarioConfirmado: false,
  diaFraisConfirmado: false,
  hlagConfirmado: false,
  flagConfirmado: false,
  primesConhecidas: [],
  intéressement: null,
  versao: 1,
}

// ─── Utilitários internos ─────────────────────────────────────────────────────

/** Mediana de um array numérico */
function mediana(valores: number[]): number {
  if (valores.length === 0) return 0
  const sorted = [...valores].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Gera ID único para uma pergunta */
function gerarId(tipo: string, boletimRef?: string): string {
  return `${tipo}_${boletimRef ?? 'global'}_${Date.now()}`
}

// ─── 1. calcularLiquidRate ────────────────────────────────────────────────────

/**
 * Recebe array de rates mensais (netPaye / salairebrut).
 * Remove anomalias: valores >5% acima ou abaixo da mediana.
 * Retorna média dos valores restantes.
 * Se array vazio → retorna 0.791 (valor confirmado dos boletins reais).
 */
export function calcularLiquidRate(historico: number[]): number {
  if (historico.length === 0) return 0.791

  const med = mediana(historico)
  const limite = med * 0.05  // 5% da mediana

  const filtrados = historico.filter(
    v => Math.abs(v - med) <= limite
  )

  if (filtrados.length === 0) return med  // todos eram anomalias — devolve mediana

  const soma = filtrados.reduce((acc, v) => acc + v, 0)
  return soma / filtrados.length
}

// ─── 2. detectarAnomalias ─────────────────────────────────────────────────────

// Estado interno para rastrear anomalias de liquidRate em meses consecutivos
// (módulo-level para persistência entre chamadas na mesma sessão)
const _anomaliasLiquidRate: Map<string, number> = new Map()

/**
 * Analisa um boletim e retorna a lista de perguntas a gerar.
 * Não modifica o padrao — apenas detecta situações que requerem confirmação.
 */
export function detectarAnomalias(
  boletim: BoletimExtraido,
  padrao: PadraoAprendido
): PerguntaPendente[] {
  const perguntas: PerguntaPendente[] = []

  // 2a. hval mudou vs padrao.hval
  if (
    boletim.hval !== null &&
    padrao.hval !== null &&
    Math.abs(boletim.hval - padrao.hval) > 0.01
  ) {
    perguntas.push({
      id: gerarId('taxa_mudou', boletim.periodo),
      tipo: 'taxa_mudou',
      pergunta: `Le taux horaire sur ta fiche est ${boletim.hval.toFixed(2)}€/h, différent du taux habituel (${padrao.hval.toFixed(2)}€/h). Ton salaire a changé?`,
      opcoes: ['Oui, c\'est mon nouveau taux', 'Non, c\'est une erreur'],
      valorContexto: { ancien: padrao.hval, nouveau: boletim.hval },
      boletimRef: boletim.periodo,
    })
  }

  // 2b. Rubriques desconhecidas
  for (const rubrique of boletim.rubriquesDesconhecidas) {
    perguntas.push({
      id: gerarId('prime_desconhecida', boletim.periodo),
      tipo: 'prime_desconhecida',
      pergunta: `J'ai trouvé une ligne "${rubrique.nome}" (${rubrique.valor.toFixed(2)}€) sur ton bulletin. C'est quel type de prime?`,
      opcoes: ['Régulière (chaque mois)', 'Exceptionnelle (ponctuelle)'],
      valorContexto: { nome: rubrique.nome, valor: rubrique.valor },
      boletimRef: boletim.periodo,
    })
  }

  // 2c. liquidRate anomalo — só perguntar se acontecer 2 meses seguidos
  if (padrao.liquidRate !== null && boletim.salairebrut > 0) {
    const rateActual = boletim.netPaye / boletim.salairebrut
    const desvio = Math.abs(rateActual - padrao.liquidRate) / padrao.liquidRate

    if (desvio > 0.05) {
      const chave = `${boletim.annee}_${boletim.moisIndex}`
      const contagem = (_anomaliasLiquidRate.get(chave) ?? 0) + 1
      _anomaliasLiquidRate.set(chave, contagem)

      if (contagem >= 2) {
        perguntas.push({
          id: gerarId('liquidrate_anomalo', boletim.periodo),
          tipo: 'liquidrate_anomalo',
          pergunta: `Le taux net/brut de ce bulletin (${(rateActual * 100).toFixed(1)}%) est différent de la normale (${(padrao.liquidRate * 100).toFixed(1)}%). Y a-t-il eu un changement dans tes cotisations?`,
          opcoes: ['Oui, situation exceptionnelle', 'Non, vérifie le calcul'],
          valorContexto: { rateActual, ratePadrao: padrao.liquidRate },
          boletimRef: boletim.periodo,
        })
      }
    } else {
      // Reset do contador quando volta ao normal
      const chave = `${boletim.annee}_${boletim.moisIndex}`
      _anomaliasLiquidRate.delete(chave)
    }
  }

  // 2d. Diferença >3% entre estimativa calculada e netPaye real
  // A estimativa simplificada usa: salairebrut * liquidRate
  if (padrao.liquidRate !== null && boletim.salairebrut > 0) {
    const estimativa = boletim.salairebrut * padrao.liquidRate
    const diferenca = Math.abs(estimativa - boletim.netPaye) / boletim.netPaye

    if (diferenca > 0.03) {
      perguntas.push({
        id: gerarId('diferenca', boletim.periodo),
        tipo: 'diferenca',
        pergunta: `J'estimais ${Math.round(estimativa)}€ net pour ${boletim.periodo}, mais ta fiche indique ${Math.round(boletim.netPaye)}€ (écart de ${Math.round(diferenca * 100)}%). Sais-tu pourquoi?`,
        opcoes: [
          'Prime ou heure supp exceptionnelle',
          'Absence ou retenue',
          'Autre raison',
          'Je ne sais pas',
        ],
        valorContexto: { estimativa, real: boletim.netPaye, diferenca },
        boletimRef: boletim.periodo,
      })
    }
  }

  return perguntas
}

// ─── 3. aplicarRespostaConduteur ──────────────────────────────────────────────

/**
 * Aplica a resposta do condutor a uma pergunta pendente.
 * Retorna novo PadraoAprendido actualizado (imutável — não modifica o original).
 */
export function aplicarRespostaConduteur(
  pergunta: PerguntaPendente,
  resposta: string,
  padrao: PadraoAprendido,
  boletim: BoletimExtraido
): PadraoAprendido {
  const novo = { ...padrao, primesConhecidas: [...padrao.primesConhecidas] }

  switch (pergunta.tipo) {
    case 'timing_salario': {
      // Espera-se que boletim.dataPagamento e boletim.mesTrabalho estejam preenchidos
      if (boletim.dataPagamento !== null && boletim.mesTrabalho !== null) {
        const diaPagamento = boletim.dataPagamento.getDate()
        const mesPagamento = boletim.dataPagamento.getMonth() // 0-11
        const anoPagamento = boletim.dataPagamento.getFullYear()

        // hlag: diferença em meses entre mesTrabalho e mês de pagamento
        // Normaliza para o mesmo ano (pode ser positivo ou 0)
        const mesTrabalho = boletim.mesTrabalho  // 0-11
        let hlag = mesPagamento - mesTrabalho
        if (hlag < 0) hlag += 12  // passou de ano

        novo.hlag = hlag
        novo.diaSalario = diaPagamento
        novo.hlagConfirmado = true
        novo.diaSalarioConfirmado = true
      }
      break
    }

    case 'timing_frais': {
      if (boletim.dataPagamento !== null && boletim.mesTrabalho !== null) {
        const diaPagamento = boletim.dataPagamento.getDate()
        const mesPagamento = boletim.dataPagamento.getMonth()

        const mesTrabalho = boletim.mesTrabalho
        let flag = mesPagamento - mesTrabalho
        if (flag < 0) flag += 12

        novo.flag = flag
        novo.diaFrais = diaPagamento
        novo.flagConfirmado = true
        novo.diaFraisConfirmado = true
      }
      break
    }

    case 'taxa_mudou': {
      if (resposta.startsWith('Oui') && boletim.hval !== null) {
        novo.hval = boletim.hval
      }
      break
    }

    case 'prime_desconhecida': {
      const ctx = pergunta.valorContexto as { nome: string; valor: number } | undefined
      if (!ctx) break

      const tipo: 'regular' | 'excepcional' = resposta === 'Régulière (chaque mois)'
        ? 'regular'
        : 'excepcional'

      // Evitar duplicados pelo nome
      const jaExiste = novo.primesConhecidas.some(p => p.nome === ctx.nome)
      if (!jaExiste) {
        novo.primesConhecidas.push({
          nome: ctx.nome,
          valor: ctx.valor,
          tipo,
          mesHabitual: tipo === 'regular' ? boletim.moisIndex : undefined,
        })
      } else {
        // Actualizar tipo se mudou
        novo.primesConhecidas = novo.primesConhecidas.map(p =>
          p.nome === ctx.nome ? { ...p, tipo, valor: ctx.valor } : p
        )
      }
      break
    }

    case 'interessement': {
      const tipoInteressement: 'anual' | 'pontual' = resposta === 'Annuel' ? 'anual' : 'pontual'
      novo.intéressement = {
        valor: boletim.rubriquesDesconhecidas.find(r =>
          r.nome.toLowerCase().includes('intéressement') ||
          r.nome.toLowerCase().includes('interessement')
        )?.valor ?? 0,
        tipo: tipoInteressement,
        mes: tipoInteressement === 'anual' ? boletim.moisIndex : undefined,
      }
      break
    }

    case 'diferenca': {
      // Regista para análise futura — não altera padrao imediatamente
      // (o actualizarPadraoComBoletim vai absorver o novo liquidRate)
      break
    }

    default:
      break
  }

  return novo
}

// ─── 4. actualizarPadraoComBoletim ───────────────────────────────────────────

/**
 * Actualiza o padrao automaticamente a partir de um boletim, sem perguntas.
 * Actualiza liquidRate, hval (se consistente), tauxEquiv, tauxNuit.
 */
export function actualizarPadraoComBoletim(
  boletim: BoletimExtraido,
  padrao: PadraoAprendido
): PadraoAprendido {
  const novo = {
    ...padrao,
    liquidRateHistorico: [...padrao.liquidRateHistorico],
    primesConhecidas: [...padrao.primesConhecidas],
  }

  // 4a. Calcular liquidRate do mês e adicionar ao histórico (FIFO, máx 6)
  if (boletim.salairebrut > 0) {
    const rateDoMes = boletim.netPaye / boletim.salairebrut
    novo.liquidRateHistorico.push(rateDoMes)
    if (novo.liquidRateHistorico.length > 6) {
      novo.liquidRateHistorico.shift()
    }
    novo.liquidRate = calcularLiquidRate(novo.liquidRateHistorico)
  }

  // 4b. Confirmar hval se extraído e consistente com o padrao actual
  if (boletim.hval !== null) {
    if (novo.hval === null) {
      // Primeira vez — adopta sem questionar
      novo.hval = boletim.hval
    } else if (Math.abs(boletim.hval - novo.hval) <= 0.01) {
      // Consistente — confirma silenciosamente (sem alteração de valor)
      novo.hval = boletim.hval
    }
    // Se diferir, não actualiza aqui — detectarAnomalias gera pergunta taxa_mudou
  }

  // 4c. tauxEquiv: taxa +25% derivada de hval e hEquiv
  // taux_25 = hval * 1.25 → mas se extraído directamente do boletim, usar esse
  if (novo.hval !== null) {
    // Estimativa padrão se não extraído directamente
    if (novo.tauxEquiv === null) {
      novo.tauxEquiv = parseFloat((novo.hval * 1.25).toFixed(4))
    }
  }

  // 4d. tauxNuit: confirmado pelo contrato colectivo transport routier
  // Valor fixo 2.486€/h salvo se já confirmado
  if (novo.tauxNuit === null) {
    novo.tauxNuit = 2.486
  }

  return novo
}

// ─── 5. gerarPerguntasObrigatorias ───────────────────────────────────────────

/**
 * Retorna as perguntas obrigatórias se os timings ainda não estiverem confirmados.
 * Estas perguntas são sempre feitas antes de qualquer estimativa ser apresentada.
 */
export function gerarPerguntasObrigatorias(
  padrao: PadraoAprendido,
  boletim: BoletimExtraido
): PerguntaPendente[] {
  const perguntas: PerguntaPendente[] = []

  if (!padrao.hlagConfirmado) {
    const netStr = Math.round(boletim.netPaye).toLocaleString('fr-FR')
    perguntas.push({
      id: gerarId('timing_salario', boletim.periodo),
      tipo: 'timing_salario',
      pergunta: `Tu as reçu ${netStr}€ sur ton compte. C'était quel jour? Et ce salaire correspond au travail de quel mois?`,
      opcoes: undefined,  // réponse libre — date picker + mois picker
      valorContexto: {
        netPaye: boletim.netPaye,
        periodo: boletim.periodo,
      },
      boletimRef: boletim.periodo,
    })
  }

  if (!padrao.flagConfirmado && boletim.fraisBoletim !== null && boletim.fraisBoletim > 0) {
    const fraisStr = Math.round(boletim.fraisBoletim).toLocaleString('fr-FR')
    perguntas.push({
      id: gerarId('timing_frais', boletim.periodo),
      tipo: 'timing_frais',
      pergunta: `Tu as reçu ${fraisStr}€ de frais sur ton compte. C'était quel jour? Et ces frais correspondent au travail de quel mois?`,
      opcoes: undefined,  // réponse libre — date picker + mois picker
      valorContexto: {
        fraisBoletim: boletim.fraisBoletim,
        periodo: boletim.periodo,
      },
      boletimRef: boletim.periodo,
    })
  }

  return perguntas
}

// ─── 6. precisaoEstimativa ────────────────────────────────────────────────────

/**
 * Retorna nível de confiança da estimativa em percentagem (0–95).
 * Penaliza se timing de salário ou frais não confirmados.
 */
export function precisaoEstimativa(
  padrao: PadraoAprendido,
  mesesConfirmados: number
): number {
  let base: number

  if (mesesConfirmados === 0) base = 0
  else if (mesesConfirmados === 1) base = 70
  else if (mesesConfirmados === 2) base = 80
  else if (mesesConfirmados === 3) base = 90
  else if (mesesConfirmados < 6)   base = 92
  else                             base = 95

  let penalizacao = 0
  if (!padrao.hlagConfirmado) penalizacao += 10
  if (!padrao.flagConfirmado) penalizacao += 10

  return Math.max(0, base - penalizacao)
}
