// src/utils/fichePdfDia.ts
// Dados do PDF «Fiche hebdo» para um dia com VÁRIOS serviços (camada pura, testável).
// Dias de serviço único NÃO passam por aqui: continuam no caminho original do Historique, byte a byte.
//
// Regras:
//  • uma linha por dia (o formulário em papel tem um bloco por dia);
//  • início = 1.º serviço, fim = último; amplitude = linha temporal real (1.º início → último fim);
//  • «pause» = só as pausas DENTRO dos serviços; o intervalo entre serviços NÃO é pausa: aparece à parte (`multi.intervallesDetail`,
//    «non classé») e na reconciliação Amplitude = Serviço + Pausas + Intervalos (nunca se força Amplitude − Pausa = Serviço);
//  • «travail» = soma dos serviços (não se subtrai o intervalo nem se reinicia nada);
//  • km = soma dos km de cada serviço (sem duplicar); cada camião/matrícula fica no comentário com os seus km.
import { resumoDia, kmDoServico, camioesDoDia, minutosDe, intervalosDoDia, type DiaGrupo, type ServicoReg } from './diasServicos'
import { textoTroca, juntarComentario } from './camioes'

/**
 * Reconciliação dos tempos de um dia com vários serviços (para o PDF). Nunca assume que o intervalo entre serviços é pausa:
 *   Amplitude = Serviço acumulado + Pausas dentro dos serviços + Intervalos entre serviços (+ resíduo, se os dados não fecharem).
 * Os intervalos aparecem à parte e SEM classificação regulamentar («non classé»).
 */
export type ResumoMultiPdf = {
  nServicos: number
  premierDebut: string
  dernierFin: string
  amplitude: string
  service: string
  pauses: string
  intervalles: string
  /** diferença entre a amplitude e a soma das partes (vazio se fecha); com sobreposição de serviços é negativa */
  residu: string
  minutos: { amplitude: number; service: number; pauses: number; intervalles: number; residu: number }
  intervallesDetail: string[]
  kmParCamion: string[]
  kmTotal: string
  frais: string
  fraisManuel: boolean
}

export type DiaPdfMulti = {
  multi: ResumoMultiPdf
  debut: string
  fin: string
  amplitude: string
  pauseTotal: string
  travailTotal: string
  travMin: number
  kmDepart: string
  kmArrivee: string
  kmTotal: string
  nuit: boolean
  vehicule: string
  commentaire: string
  temSobreposicao: boolean
}

export const fmtMinPdf = (m: number): string => (m > 0 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : '')

/** Mesmo cálculo do Historique para UM serviço: amplitude − pausa = trabalho (minutos inteiros). */
export function minutosServicoPdf(s: ServicoReg): { ampMin: number; pausaMin: number; travMin: number } {
  const a = minutosDe(s.debut) ?? 0
  const b = minutosDe(s.fin) ?? 0
  let ampMin = b - a
  if (ampMin < 0) ampMin += 1440
  const pausaMin = Math.round((Number(s.segPausa) || 0) / 60)
  const travMin = ampMin > 0 ? Math.max(0, ampMin - pausaMin) : Math.round((Number(s.segServico) || 0) / 60)
  return { ampMin, pausaMin, travMin }
}

const mesmoCamiao = (cs: string[]): boolean => cs.length <= 1

export function montarDiaPdfMulti(g: DiaGrupo, opcoes: { fraisOpts?: Parameters<typeof resumoDia>[1] } = {}): DiaPdfMulti {
  const t = g.trabalho
  const r = resumoDia(g, opcoes.fraisOpts ?? {})
  const porServico = t.map(minutosServicoPdf)
  const travMin = porServico.reduce((a, x) => a + x.travMin, 0)
  const pausaMin = porServico.reduce((a, x) => a + x.pausaMin, 0)
  // amplitude real; se faltarem horas válidas, cai para a soma das amplitudes dos serviços
  const ampMin = r.amplitudeSeg !== null ? Math.round(r.amplitudeSeg / 60) : porServico.reduce((a, x) => a + x.ampMin, 0)
  const interMin = Math.round(r.intervaloEntreServicosSeg / 60)

  const kmServicos = t.map(kmDoServico)
  const kmSoma = kmServicos.reduce((a, k) => a + k, 0)
  const camioes = camioesDoDia(t)
  // km início/fim só quando batem certo com a soma (um só camião e sem km de outros pelo meio); senão ficam vazios
  const primeiro = t[0], ultimo = t[t.length - 1]
  const kmI = Number(primeiro?.troca ? primeiro.troca.a.kmInicio : primeiro?.kmInicio) || 0
  const kmF = Number(ultimo?.troca ? ultimo.troca.b.kmFim : ultimo?.kmFim) || 0
  const consistente = mesmoCamiao(camioes) && kmI > 0 && kmF > 0 && kmF >= kmI && Math.round(kmF - kmI) === Math.round(kmSoma)

  const partes = t.map((s, i) => {
    const m = porServico[i]
    const base = `${i + 1}) ${s.debut}→${s.fin} · ${fmtMinPdf(m.travMin) || '0h00'}`
    const km = kmServicos[i]
    if (s.troca) return `${base} · ${textoTroca(s.troca)}`
    const placa = String(s.camiao?.value ?? '').trim()
    return `${base}${placa ? ` · ${placa}` : ''}${km > 0 ? ` · ${km} km` : ''}`
  })
  let auto = `${t.length} services : ${partes.join(' ; ')}`
  if (r.temSobreposicao) auto += `. Attention : services qui se chevauchent`
  const residuMin = ampMin - (travMin + pausaMin + interMin)
  const fmtSinal = (m: number) => (m === 0 ? '' : `${m < 0 ? '−' : ''}${fmtMinPdf(Math.abs(m))}`)
  const kmPorCamion = r.kmPorCamiao.map(k => `${k.matricula || 'sans matricule'} : ${Math.round(k.km)} km`)
  const multi: ResumoMultiPdf = {
    nServicos: t.length,
    premierDebut: r.debut,
    dernierFin: r.fin,
    amplitude: fmtMinPdf(ampMin) || '0h00',
    service: fmtMinPdf(travMin) || '0h00',
    pauses: fmtMinPdf(pausaMin) || '0h00',
    intervalles: fmtMinPdf(interMin) || '0h00',
    residu: fmtSinal(residuMin),
    minutos: { amplitude: ampMin, service: travMin, pauses: pausaMin, intervalles: interMin, residu: residuMin },
    intervallesDetail: intervalosDoDia(g).map(x => `${x.de}→${x.para} : ${fmtMinPdf(Math.round(x.seg / 60))} — non classé (ni pause ni repos confirmé)`),
    kmParCamion: kmPorCamion,
    kmTotal: kmSoma > 0 ? String(Math.round(kmSoma)) : '',
    frais: `${r.frais.toFixed(2).replace('.', ',')} €`,
    fraisManuel: r.fraisManual,
  }
  const nota = t.map(s => (s as any).nota?.texto).find(x => typeof x === 'string' && x.trim()) as string | undefined

  return {
    multi,
    debut: r.debut,
    fin: r.fin,
    amplitude: fmtMinPdf(ampMin),
    pauseTotal: fmtMinPdf(pausaMin),
    travailTotal: fmtMinPdf(travMin),
    travMin,
    kmDepart: consistente ? String(Math.round(kmI)) : '',
    kmArrivee: consistente ? String(Math.round(kmF)) : '',
    kmTotal: kmSoma > 0 ? String(Math.round(kmSoma)) : '',
    nuit: r.decouche,
    vehicule: camioes.join(' / '),
    commentaire: juntarComentario(nota, auto),
    temSobreposicao: r.temSobreposicao,
  }
}
