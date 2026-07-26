// src/types/moisdata.ts
// Tipo partilhado entre fiche.tsx, projecoes.ts e qualquer outro módulo que precise de MoisData

export type MoisData = {
  periode: string; moisIndex: number; annee: number; fichePages: number
  mesFicheIndex?: number; anoFiche?: number
  mesTrabalhoIndex?: number; anoTrabalho?: number
  mesPagamentoIndex?: number; anoPagamento?: number
  mesFraisTrabalhoIndex?: number; anoFraisTrabalho?: number
  fonte?: 'confirmado' | 'ia' | 'editado'
  confiancaAprendizagem?: number
  netPaye: number; salairebrut: number; totalCotisations: number
  remboursementFrais: number; fraisBoletim: number; montantTotalRecu: number
  interessement?: number; primeExceptionnelle?: number; participationSalariale?: number; autresPrimes?: number
  primeNonAccident?: number
  jourPaiement1: number; jourPaiement2: number; analysedAt: string
  entreprise: string; conducteur: string
  // Campos novos extraídos pela IA das fiches
  joursConges?: number; montantConges?: number
  joursFeries?: number; montantFeries?: number
  joursRC?: number; montantRC?: number; totalHeures?: number
  // Coeficientes salariais reais extraídos da fiche
  hbase?: number; hval?: number; h25?: number; lim25?: number; h50?: number
  // Confirmações reais dadas pelo motorista (mês/dia em que recebeu)
  salarioConfirmado?: boolean; fraisConfirmado?: boolean
  moisAtipico?: boolean
  fraisRecuConfirme?: number
  pagamentoSalMesIndex?: number; pagamentoSalAno?: number
  pagamentoFraisMesIndex?: number; pagamentoFraisAno?: number
  estimativaSnapshot?: number
}
