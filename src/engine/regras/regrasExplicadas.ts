// src/engine/regras/regrasExplicadas.ts
// «Comprendre cette règle»: explicação em francês simples de CADA regra que o motor usa, com o artigo oficial
// (as mesmas referências de referencias.ts) e a ligação à fonte oficial. Conteúdo estático.
//
// LIGAÇÕES OFICIAIS — como foram obtidas (honestidade):
//  • EUR-Lex: ligação ao Reg. (CE) 561/2006 pelo número CELEX 32006R0561 (a pesquisa devolveu esta mesma página).
//  • Légifrance: URLs `article_lc/LEGIARTI…` devolvidos por pesquisa, cujo título era exatamente o artigo
//    (L3312-1, L3312-2, R3312-50, R3312-51). O texto primário destes artigos NÃO foi relido pelo motor (leitura
//    automática bloqueada) — por isso as verificações em referencias.ts continuam 'fonte_oficial_secundaria'.
//  • Cada ligação está associada SÓ ao seu artigo; nunca se usa a ligação de um artigo para outro. O Reg. 561/2006
//    liga à página do regulamento (os n.os 2 e 4 do art. 8.º estão dentro dela).
import { REF } from './referencias'
import type { ResultadoMotor } from './orquestrador'
import type { NivelVerificacao } from './tipos'

export type IdRegra = 'amplitude_561_8_2' | 'reducoes_561_8_4' | 'servico_r3312_51' | 'noturno_l3312_1' | 'pausas_l3312_2' | 'semanal_r3312_50'

export type LigacaoOficial = { origem: 'EUR-Lex' | 'Légifrance'; rotulo: string; url: string }

export type RegraExplicada = {
  id: IdRegra
  titre: string
  explication: string
  conditions: string[]
  /** identificação do artigo (de referencias.ts) */
  reference: string
  verificacao: NivelVerificacao
  lien: LigacaoOficial
  nonVerifie: string[]
}

const LIEN_561: LigacaoOficial = { origem: 'EUR-Lex', rotulo: 'Règlement (CE) n° 561/2006 — EUR-Lex', url: 'https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX%3A32006R0561' }
const legi = (id: string, rotulo: string): LigacaoOficial => ({ origem: 'Légifrance', rotulo, url: `https://www.legifrance.gouv.fr/codes/article_lc/${id}` })

export const REGRAS: Record<IdRegra, RegraExplicada> = {
  amplitude_561_8_2: {
    id: 'amplitude_561_8_2',
    titre: 'Amplitude : le repos quotidien dans les 24 h',
    explication:
      "Après la fin de ton repos précédent, tu dois avoir terminé un nouveau repos quotidien dans les 24 h. Repos normal : 11 h au moins. Repos réduit : 9 h au moins (mais moins de 11 h). L'amplitude maximale est donc de 13 h avec un repos de 11 h, ou de 15 h avec un repos réduit de 9 h.",
    conditions: [
      'Le règlement (CE) 561/2006 doit s’appliquer à ton véhicule (en général, plus de 3,5 t).',
      'La fin du repos précédent doit être connue.',
    ],
    reference: REF.CE561_ART8_2.id,
    verificacao: REF.CE561_ART8_2.verificacao,
    lien: LIEN_561,
    nonVerifie: ['Conduite en équipage et repos quotidien fractionné (3 h + 9 h) : non pris en charge.'],
  },
  reducoes_561_8_4: {
    id: 'reducoes_561_8_4',
    titre: 'Repos réduits : 3 au maximum entre deux repos hebdomadaires',
    explication:
      "Entre deux repos hebdomadaires, tu peux ramener au plus trois fois le repos quotidien de 11 h à 9 h. Le moteur ne montre l'option du repos réduit que si une réduction est encore possible ou si le nombre de réductions déjà utilisées est inconnu (dans ce cas c'est une simulation).",
    conditions: ['Il faut connaître le dernier repos hebdomadaire pour compter les réductions déjà utilisées.'],
    reference: REF.CE561_ART8_4.id,
    verificacao: REF.CE561_ART8_4.verificacao,
    lien: LIEN_561,
    nonVerifie: ['Le décompte des réductions est déduit de l’historique, sauf si tu le confirmes.'],
  },
  servico_r3312_51: {
    id: 'servico_r3312_51',
    titre: 'Temps de service : 12 h par jour',
    explication: 'Le temps de service quotidien ne peut pas dépasser 12 heures.',
    conditions: ['Transport public routier de marchandises soumis au Code des transports.', "Le « service » de l'application doit correspondre au temps de service réglementaire."],
    reference: REF.R3312_51.id,
    verificacao: REF.R3312_51.verificacao,
    lien: legi('LEGIARTI000033450339', 'Article R3312-51 — Légifrance'),
    nonVerifie: ["Texte de l'article non relu directement : valeur issue de sources officielles de synthèse."],
  },
  noturno_l3312_1: {
    id: 'noturno_l3312_1',
    titre: 'Travail de nuit : 10 h au maximum',
    explication: "Si une partie de ton travail est effectuée entre 0 h et 5 h, la durée quotidienne du travail ne peut pas dépasser 10 heures. Le moteur applique ce plafond de 10 h seulement si le service touche cette plage.",
    conditions: ["Le service touche la plage 0 h – 5 h."],
    reference: REF.L3312_1.id,
    verificacao: REF.L3312_1.verificacao,
    lien: legi('LEGIARTI000033021297', 'Article L3312-1 — Légifrance'),
    nonVerifie: ["La loi parle de temps de TRAVAIL (hors disponibilité) ; l'application ne mesure que le « service », utilisé comme approximation par excès."],
  },
  pausas_l3312_2: {
    id: 'pausas_l3312_2',
    titre: 'Pauses de travail : 30 min après 6 h, 45 min après 9 h',
    explication:
      "Une pause d'au moins 30 minutes est exigée quand le travail quotidien dépasse 6 h, et d'au moins 45 minutes au-delà de 9 h. Elle peut être fractionnée en périodes de 15 minutes minimum. Il ne faut jamais travailler plus de 6 h d'affilée sans pause.",
    conditions: ['Seules comptent les pauses de 15 minutes ou plus.', 'Une pause ne compte que si tu confirmes qu’elle est du temps libre de toute activité.'],
    reference: REF.L3312_2.id,
    verificacao: REF.L3312_2.verificacao,
    lien: legi('LEGIARTI000026054561', 'Article L3312-2 — Légifrance'),
    nonVerifie: [
      "La nature des pauses n'est pas connue : aucune pause de l'application n'est comptée comme réglementaire sans confirmation.",
      'Les pauses créées automatiquement lors d’un changement de camion ne comptent jamais.',
      'La pause de conduite (45 min après 4 h 30 de conduite) est une autre règle, non évaluée.',
    ],
  },
  semanal_r3312_50: {
    id: 'semanal_r3312_50',
    titre: 'Temps de service hebdomadaire (semaine isolée)',
    explication: "Sur une semaine isolée, le temps de service ne peut pas dépasser : 56 h (grands routiers / longue distance), 52 h (autres conducteurs de marchandises), 48 h (messagerie et transport de fonds).",
    conditions: ['La catégorie réglementaire doit être connue (elle n’est jamais déduite de CD/MIXTE/LD).', 'La semaine doit être complète dans l’historique.'],
    reference: REF.R3312_50.id,
    verificacao: REF.R3312_50.verificacao,
    lien: legi('LEGIARTI000033450337', 'Article R3312-50 — Légifrance'),
    nonVerifie: ['Les moyennes sur période de référence (53 h / 50 h / 44 h) ne sont pas prises en charge.'],
  },
}

export const ORDEM_REGRAS: readonly IdRegra[] = ['amplitude_561_8_2', 'reducoes_561_8_4', 'servico_r3312_51', 'noturno_l3312_1', 'pausas_l3312_2', 'semanal_r3312_50']

export const todasAsRegras = (): RegraExplicada[] => ORDEM_REGRAS.map(id => REGRAS[id])

/** Regras EFETIVAMENTE usadas no resultado atual do motor. Sem motor (sem serviço) → todas as regras suportadas. */
export function regrasUsadas(motor: ResultadoMotor | null): RegraExplicada[] {
  if (!motor) return todasAsRegras()
  const ids: IdRegra[] = []
  const r = (id: string) => motor.restricoes.find(x => x.id === id)
  const amp = r('amplitude_janela_descanso')
  if (amp?.avaliada) {
    ids.push('amplitude_561_8_2')
    if (motor.janelasDescanso.reduzidoMs !== null || motor.janelasDescanso.reduzidoDisponivel === false) ids.push('reducoes_561_8_4')
  }
  const srv = r('servico_diario')
  if (srv?.avaliada) {
    ids.push('servico_r3312_51')
    if (srv.detalhe?.trabalhoNoturno === true) ids.push('noturno_l3312_1')
  }
  if (motor.pausas) ids.push('pausas_l3312_2')
  if (r('servico_semanal_isolado')?.avaliada) ids.push('semanal_r3312_50')
  return ids.map(id => REGRAS[id])
}
