// src/assistente/interpretador.ts
// Interpretador DETERMINÍSTICO de perguntas livres (francês e português). Sem IA, sem rede, sem armazenamento.
//
// O QUE FAZ: transforma um texto em «intenção + parâmetros» (hora de fim, duração de pausa). NADA MAIS.
// O QUE NÃO FAZ: não calcula nada, não lê dados do motorista e não importa o motor — as respostas vêm sempre do
// motor existente, ligado em `respostaLivre.ts`.
//
// REGRA DE OURO: nunca escolher uma intenção incerta só porque uma palavra coincide.
//  • cada intenção tem padrões FORTES (peso ≥ 3: frase inequívoca) e FRACOS (peso 1: uma palavra solta);
//  • só se escolhe uma intenção com pontuação ≥ LIMIAR_FORTE e com margem sobre a seguinte;
//  • empate entre intenções → «ambígua» (o ecrã pergunta); nada reconhecido → «fora de âmbito».
//  • horas vs durações só são extraídas quando inequívocas; «18h» sem contexto não é adivinhada.
//
// FUTURO: o contrato `InterpretadorPergunta` permite trocar este módulo por outro (p. ex. IA externa) sem tocar
// no motor — a IA só traduziria a frase em `Interpretacao`; os números continuam a vir do motor local.

export type Idioma = 'fr' | 'pt' | 'indefinido'

export type IntencaoId =
  | 'amplitude' | 'servico' | 'repouso' | 'pausas' | 'pausa_limite' | 'simulacao_fim'
  | 'regras' | 'sancoes' | 'conducao' | 'repouso_semanal'

export type HoraRelogio = { h: number; m: number }

export type Quantidade =
  | { tipo: 'hora'; h: number; m: number; texto: string }
  | { tipo: 'duracao'; min: number; texto: string }
  | { tipo: 'ambigua'; h: number; m: number; texto: string }

/** o que falta para a intenção ser respondida (a pergunta foi reconhecida, mas incompleta) */
export type Falta = 'hora_fim' | 'hora_ou_duracao' | 'hora_unica'

export type Interpretacao =
  | {
    tipo: 'intencao'
    intencao: IntencaoId
    idioma: Idioma
    horaFim: HoraRelogio | null
    duracaoMin: number | null
    /** horas/durações encontradas mas que a intenção não usa (para avisar o utilizador) */
    ignoradas: Quantidade[]
    falta: Falta | null
    pontuacao: number
    textoNormalizado: string
  }
  | { tipo: 'ambigua'; idioma: Idioma; candidatas: IntencaoId[]; textoNormalizado: string }
  | { tipo: 'fora_ambito'; idioma: Idioma; textoNormalizado: string }
  | { tipo: 'vazia' }

export interface InterpretadorPergunta {
  interpretar(texto: string): Promise<Interpretacao>
}

export const MAX_CARACTERES = 200
export const LIMIAR_FORTE = 3
export const MARGEM_MINIMA = 2

// ───────────────────────────── normalização ─────────────────────────────
/** minúsculas, sem acentos, sem pontuação (mantém dígitos, letras e «:» entre dígitos). */
export function normalizarTexto(bruto: string): string {
  let t = String(bruto ?? '').slice(0, MAX_CARACTERES * 2).toLowerCase()
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '')
  t = t.replace(/œ/g, 'oe').replace(/æ/g, 'ae')
  t = t.replace(/[’'`´‘]/g, ' ')
  t = t.replace(/(\d)\s*:\s*(\d)/g, '$1:$2')
  t = t.replace(/[^a-z0-9: ]+/g, ' ')
  t = t.replace(/(^|[^0-9]):|:(?![0-9])/g, '$1 ')
  return t.replace(/\s+/g, ' ').trim()
}

// ───────────────────────────── idioma ─────────────────────────────
const MARC_FR = /\b(je|puis|peux|quel|quelle|quels|combien|dois|mon|mes|les|une|des|du|pour|avec|vers|jusqu|quand|heure|heures|temps|reste|restent|prendre|faire|suis|est|pas|ai|dans|apres|avant|aujourd|hui|ou|et|si|finis|termine|arrete)\b/g
const MARC_PT = /\b(eu|posso|consigo|qual|quais|quanto|quanta|quantas|tenho|devo|meu|minha|os|uma|para|com|ate|hora|horas|tempo|resta|restam|fazer|tirar|sou|nao|depois|antes|dentro|quando|se|ao|preciso|terminar|acabar|parar|descanso|servico|trabalhar)\b/g

export function detetarIdioma(n: string): Idioma {
  const fr = (n.match(MARC_FR) ?? []).length
  const pt = (n.match(MARC_PT) ?? []).length
  if (fr === pt) return 'indefinido'
  return fr > pt ? 'fr' : 'pt'
}

// ───────────────────────────── horas e durações ─────────────────────────────
const CUE_DURACAO = /(?:pause|pausa|repos|descanso|pendant|durante|dure|duree|duracao|dans|daqui a|dentro de|avec|com|prolonge|rallonge)(?: de| d| do| da)?\s*$/
const CUE_HORA = /(?:^|\s)(?:a|as|vers|ate|ate as|jusqu a|jusqu|avant|antes de|apres|depois das?|depois de)\s*$/
const VERBOS_FIM = /\b(finir|finis|finit|fin|terminer|termine|arreter|arrete|stopper|stoppe|rentrer|rentre|rouler|roule|travailler|travaille|partir|pars|terminar|termino|acabar|acabo|parar|paro|chegar|chego|sair|saio|rodar|rodo|trabalhar|trabalho|conduzir)\b/

const horaValida = (h: number, m: number) => Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59

type Achado = { ini: number; fim: number; h: number; m: number; forma: 'relogio' | 'minutos' | 'heures'; temMin: boolean; texto: string }

/** Extrai quantidades. Cada span é consumido uma só vez (evita contar «1h 30 min» duas vezes). */
export function extrairQuantidades(n: string): Quantidade[] {
  let resto = n
  const achados: Achado[] = []
  const consumir = (re: RegExp, f: (m: RegExpExecArray) => Achado | null) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    const blocos: Array<[number, number]> = []
    while ((m = re.exec(resto)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      const a = f(m)
      if (a) { achados.push(a); blocos.push([a.ini, a.fim]) }
    }
    for (const [i, j] of blocos) resto = resto.slice(0, i) + ' '.repeat(j - i) + resto.slice(j)
  }

  // 18:30
  consumir(/\b(\d{1,2}):(\d{2})\b/g, m => ({ ini: m.index, fim: m.index + m[0].length, h: +m[1], m: +m[2], forma: 'relogio', temMin: true, texto: m[0] }))
  // 18h, 18h30, 18 h 30  (os minutos só contam se não forem seguidos de «min»)
  consumir(/\b(\d{1,2}) ?h(?![a-z])(?: ?(\d{2})(?! ?(?:min|mn|minute|mins)\b)(?!\d))?/g,
    m => ({ ini: m.index, fim: m.index + m[0].length, h: +m[1], m: m[2] ? +m[2] : 0, forma: 'relogio', temMin: !!m[2], texto: m[0].trim() }))
  // 18 heures / 2 horas
  consumir(/\b(\d{1,2}) ?(?:heures?|horas?|hrs?)\b(?: ?(?:et )?(\d{2})(?! ?(?:min|mn|minute|mins)\b)(?!\d))?/g,
    m => ({ ini: m.index, fim: m.index + m[0].length, h: +m[1], m: m[2] ? +m[2] : 0, forma: 'heures', temMin: !!m[2], texto: m[0].trim() }))
  // 30 min
  consumir(/\b(\d{1,3}) ?(?:minutes?|mins?|mn)\b/g,
    m => ({ ini: m.index, fim: m.index + m[0].length, h: 0, m: +m[1], forma: 'minutos', temMin: true, texto: m[0].trim() }))
  // palavras
  consumir(/\b(?:une |um |uma )?(?:demi heure|meia hora)\b/g,
    m => ({ ini: m.index, fim: m.index + m[0].length, h: 0, m: 30, forma: 'minutos', temMin: true, texto: m[0].trim() }))
  consumir(/\b(?:minuit|meia noite)\b/g,
    m => ({ ini: m.index, fim: m.index + m[0].length, h: 0, m: 0, forma: 'relogio', temMin: true, texto: m[0].trim() }))
  consumir(/\b(?:midi|meio dia)\b/g,
    m => ({ ini: m.index, fim: m.index + m[0].length, h: 12, m: 0, forma: 'relogio', temMin: true, texto: m[0].trim() }))

  achados.sort((a, b) => a.ini - b.ini)
  const temVerboFim = VERBOS_FIM.test(n)
  const out: Quantidade[] = []
  for (let k = 0; k < achados.length; k++) {
    const a = achados[k]
    const antes = n.slice(Math.max(0, a.ini - 30), a.ini)
    if (a.forma === 'minutos') { out.push({ tipo: 'duracao', min: a.m, texto: a.texto }); continue }
    let duracaoMin = a.h * 60 + a.m
    // «pause de 1h 30 min»: com pista de duração, as horas e os minutos seguintes são UMA só duração
    const seg = achados[k + 1]
    if (CUE_DURACAO.test(antes) && !a.temMin && seg && seg.forma === 'minutos' && seg.ini - a.fim <= 1) {
      out.push({ tipo: 'duracao', min: duracaoMin + seg.m, texto: `${a.texto} ${seg.texto}` })
      k++
      continue
    }
    if (CUE_DURACAO.test(antes)) { out.push({ tipo: 'duracao', min: duracaoMin, texto: a.texto }); continue }
    const horaOk = horaValida(a.h, a.m)
    if (CUE_HORA.test(antes)) {
      if (horaOk) out.push({ tipo: 'hora', h: a.h, m: a.m, texto: a.texto })
      continue // hora inválida (ex.: 25h) → ignorada, nunca corrigida
    }
    if (a.forma === 'relogio' && (a.temMin || a.texto === 'minuit' || a.texto === 'midi' || a.texto === 'meia noite' || a.texto === 'meio dia')) {
      if (horaOk) out.push({ tipo: 'hora', h: a.h, m: a.m, texto: a.texto })
      continue
    }
    if (horaOk && (temVerboFim || a.h >= 13)) { out.push({ tipo: 'hora', h: a.h, m: a.m, texto: a.texto }); continue }
    if (horaOk) { out.push({ tipo: 'ambigua', h: a.h, m: a.m, texto: a.texto }); continue }
  }
  return out
}

// ───────────────────────────── intenções ─────────────────────────────
/** `exigeHora`: só conta se a frase tiver uma hora inequívoca (ex.: «puis-je rouler» sozinho não é uma simulação). */
type Padrao = { re: RegExp; w: number; exigeHora?: boolean }
const P = (re: RegExp, w: number, exigeHora = false): Padrao => ({ re, w, exigeHora })

const PADROES: Record<IntencaoId, Padrao[]> = {
  amplitude: [
    P(/\bamplitude/, 3),
    P(/jusqu a quand .{0,20}(travailler|rouler|conduire|bosser|continuer|tenir)/, 3),
    P(/ate quando (posso|consigo|tenho|da para)/, 3),
    P(/\bfin (de|d) amplitude|\bfim da amplitude/, 3),
    P(/jusqu a quand/, 1), P(/ate quando/, 1), P(/\bfenetre\b/, 1), P(/il me reste|me resta|combien de temps me reste|quanto tempo me resta/, 1),
  ],
  servico: [
    P(/temps de service|tempo de servico|heures? de service|horas de servico/, 3),
    P(/service restant|servico restante|reste.{0,12}de service|resta.{0,12}de servico/, 3),
    P(/temps de travail|tempo de trabalho|heures? de travail|horas de trabalho/, 3),
    P(/limite (journaliere|diaria|de service|de servico)/, 3),
    P(/(service|servico) (de la |sur la |da |na |nesta )?(semaine|semana)/, 3),
    P(/combien d heures?|quantas horas/, 2),
    P(/\bservice\b|\bservico\b|\btravail|\btrabalh|\bnuit\b|\bnoite\b/, 1), P(/il me reste|me resta|restant|combien de temps me reste|quanto tempo me resta/, 1),
  ],
  repouso: [
    P(/repos (quotidien|journalier|reduit|normal)|descanso (diario|reduzido|normal)/, 3),
    P(/\bquel repos\b|\bque descanso\b|\bqual (o )?descanso\b/, 3),
    P(/quand .{0,25}(m arreter|arreter|stopper|dormir|repos)\b/, 3),
    P(/quando .{0,25}(parar|descansar|dormir|descanso)\b/, 3),
    P(/(repos|descanso) de (9|11)\b|\b(9|11) ?h(eures)? (de )?(repos|descanso)/, 3),
    P(/heure (limite )?(du|de) repos|hora (limite )?do descanso/, 3),
    P(/\brepos\b|\bdescans|\bdormir\b|\bcoucher\b|\breduit\b|\breduzid/, 1),
  ],
  repouso_semanal: [
    P(/repos (hebdomadaire|hebdo)|descanso semanal|repos de 45|descanso de 45|repos .{0,15}semaine/, 4),
  ],
  pausas: [
    P(/pauses? (obligatoire|exigee|requise|necessaire|minimum|reglementaire|legale)/, 3),
    P(/pausas? (obrigatoria|exigida|necessaria|minima|regulamentar|legal)/, 3),
    P(/combien de pause|quanta pausa|quantas pausas|quanto tempo de pausa|temps de pause|tempo de pausa/, 3),
    P(/(dois|doit) je (faire|prendre|avoir) .{0,18}pause|devo (fazer|tirar|ter) .{0,18}pausa|preciso .{0,18}pausa/, 3),
    P(/(ai je|ja fiz|fiz) .{0,15}(pause|pausa)/, 3),
    P(/\b(30|45) ?(min|minutes?) de pause|\b(30|45) ?(min|minutos) de pausa/, 3),
    P(/\bpauses?\b|\bpausas?\b/, 1),
  ],
  pausa_limite: [
    P(/(a quelle heure|quand|avant quelle heure|jusqu a quelle heure|heure limite|dernier moment|au plus tard).{0,40}\bpauses?\b/, 4),
    P(/\bpauses?\b.{0,30}(a quelle heure|au plus tard|heure limite|avant quelle heure)/, 4),
    P(/(a que horas|ate que horas|hora limite|o mais tardar|quando).{0,40}\bpausas?\b/, 4),
    P(/\bpausas?\b.{0,30}(a que horas|hora limite|ate que horas|o mais tardar)/, 4),
  ],
  simulacao_fim: [
    P(/\bsi (je )?(finis|termine|m arrete|arrete|rentre|roule|travaille|continue|stoppe|pars)\b/, 3),
    P(/\bse (eu )?(terminar|acabar|parar|rodar|trabalhar|sair|chegar|continuar|acabo|termino|paro)\b/, 3),
    P(/(puis|peux|peut) ?je (finir|terminer|rouler|travailler|continuer|rentrer|arreter|conduire)\b/, 3, true),
    P(/(posso|consigo) (terminar|acabar|trabalhar|rodar|continuar|conduzir|chegar|parar)\b/, 3, true),
    P(/\b(finir|terminer|arreter|stopper|rentrer)\b.{0,20}\b(a|vers|avant|apres)\b/, 3),
    P(/\b(terminar|acabar|parar)\b.{0,20}\b(as|ate|antes|depois)\b/, 3),
    P(/\b(fin|fim) de (service|servico)\b/, 2),
    P(/\be se\b|\bet si\b/, 2),
  ],
  regras: [
    P(/\bregles?\b|\breglementation\b|\breglement\b|\bregulamento|\bregulamentacao|\bregras?\b/, 3),
    P(/\b561\b|\b(l|r) ?3312\b|code des transports/, 3),
    P(/que dit (la loi|le reglement)|o que diz (a lei|o regulamento)/, 4),
    P(/sources? officielles?|fontes? oficiais|\barticle\b|\bartigo\b/, 3),
    P(/\bloi\b|\blei\b/, 2),
  ],
  sancoes: [
    P(/\bsanctions?\b|\bamendes?\b|\bcontraventions?\b|\binfractions?\b|\bpenalit|\bpunitions?\b|\bmultas?\b|\bcoimas?\b|contra ?ordenac|\binfracao|\binfracoes\b|\bpv\b|retrait de points?|immobilisation/, 3),
    P(/je risque|o que arrisco|risco de|risque.{0,12}(gros|quoi)/, 2),
  ],
  conducao: [
    P(/temps de conduite|tempo de conducao|heures? de conduite|horas de conducao/, 4),
    P(/\bconduite\b|\bconducao\b|\bconduire\b|\bconduzir\b/, 3),
    P(/\b4 ?h ?30\b|\b4h30\b/, 4),
    P(/chronotachygraphe|tachygraphe|cronotacografo|tacografo|tachograph/, 3),
    P(/\brouler\b|\brodar\b|\bvolant\b|\bvolante\b/, 1),
  ],
}

/** especialista > generalista quando ambos pontuam (ex.: «si je finis à 18h avec 30 min de pause»). */
const ESPECIALISTA_DE: Array<[IntencaoId, IntencaoId[]]> = [
  ['simulacao_fim', ['amplitude', 'servico', 'repouso', 'pausas']],
  ['pausa_limite', ['pausas']],
  ['sancoes', ['regras']],
  ['repouso_semanal', ['repouso']],
  ['conducao', ['pausas', 'servico']],
]

export const ROTULO_INTENCAO: Record<IntencaoId, string> = {
  amplitude: 'Amplitude restante',
  servico: 'Temps de service restant',
  repouso: 'Repos quotidien',
  pausas: 'Pauses',
  pausa_limite: "Heure limite d'une pause",
  simulacao_fim: 'Simulation avec une heure de fin',
  regras: 'Règles',
  sancoes: 'Sanctions',
  conducao: 'Temps de conduite',
  repouso_semanal: 'Repos hebdomadaire',
}

function pontuar(n: string, temHora: boolean): Record<IntencaoId, number> {
  const out = {} as Record<IntencaoId, number>
  for (const id of Object.keys(PADROES) as IntencaoId[]) {
    let forte = 0
    let fraco = 0
    for (const p of PADROES[id]) {
      if (p.exigeHora && !temHora) continue
      if (!p.re.test(n)) continue
      if (p.w >= 2) forte = Math.max(forte, p.w) // o padrão mais forte decide: várias frases iguais não somam
      else fraco = Math.max(fraco, p.w)
    }
    out[id] = forte > 0 ? forte : fraco
  }
  return out
}

export function interpretar(texto: string): Interpretacao {
  const bruto = String(texto ?? '').trim()
  if (!bruto) return { tipo: 'vazia' }
  const n = normalizarTexto(bruto.slice(0, MAX_CARACTERES))
  if (!n) return { tipo: 'vazia' }
  const idioma = detetarIdioma(n)

  const quant = extrairQuantidades(n)
  const horas = quant.filter((q): q is Extract<Quantidade, { tipo: 'hora' }> => q.tipo === 'hora')
  const duracoes = quant.filter((q): q is Extract<Quantidade, { tipo: 'duracao' }> => q.tipo === 'duracao')
  const ambiguas = quant.filter((q): q is Extract<Quantidade, { tipo: 'ambigua' }> => q.tipo === 'ambigua')

  const pont = pontuar(n, horas.length >= 1)
  // uma hora com pista de «fim» reforça a simulação, mas SÓ se já houver uma frase de simulação (nunca sozinha)
  if (pont.simulacao_fim >= 2 && horas.length + ambiguas.length >= 1) pont.simulacao_fim = Math.max(pont.simulacao_fim, 4)
  if (pont.simulacao_fim < LIMIAR_FORTE && horas.length === 1 && /\b(jusqu a|ate|ate as|avant)\b/.test(n) && /(puis|peux|posso|consigo|rouler|rodar|travailler|trabalhar|conduire|conduzir)/.test(n)) {
    pont.simulacao_fim = 4
  }

  const ordem = (Object.keys(pont) as IntencaoId[]).sort((a, b) => pont[b] - pont[a])
  const top = ordem[0]
  const fortes = ordem.filter(i => pont[i] >= LIMIAR_FORTE)

  const resolver = (id: IntencaoId, pontuacao: number): Interpretacao => {
    const usaHora = id === 'simulacao_fim'
    const usaDuracao = id === 'simulacao_fim' || id === 'servico' || id === 'pausas'
    let falta: Falta | null = null
    let horaFim: HoraRelogio | null = null
    let duracaoMin: number | null = null
    const ignoradas: Quantidade[] = []

    if (usaHora) {
      if (horas.length === 1) horaFim = { h: horas[0].h, m: horas[0].m }
      else if (horas.length > 1) falta = 'hora_unica'
      else if (ambiguas.length > 0) falta = 'hora_ou_duracao'
      else falta = 'hora_fim'
    } else ignoradas.push(...horas, ...ambiguas)

    if (usaDuracao) {
      if (duracoes.length === 1) duracaoMin = duracoes[0].min
      else if (duracoes.length > 1) falta = falta ?? 'hora_unica'
      if (id !== 'simulacao_fim' && ambiguas.length > 0) ignoradas.push(...ambiguas)
    } else ignoradas.push(...duracoes)
    return { tipo: 'intencao', intencao: id, idioma, horaFim, duracaoMin, ignoradas, falta, pontuacao, textoNormalizado: n }
  }

  if (pont[top] >= LIMIAR_FORTE) {
    // especialista sobre generalista
    for (const [esp, gerais] of ESPECIALISTA_DE) {
      if (pont[esp] >= LIMIAR_FORTE && fortes.every(f => f === esp || gerais.includes(f))) return resolver(esp, pont[esp])
    }
    const segundo = ordem[1]
    if (pont[segundo] >= LIMIAR_FORTE && pont[top] - pont[segundo] < MARGEM_MINIMA) {
      return { tipo: 'ambigua', idioma, candidatas: fortes.slice(0, 3), textoNormalizado: n }
    }
    return resolver(top, pont[top])
  }

  // só palavras soltas: nunca escolhemos; perguntamos se o texto for curto ou houver mais do que uma pista
  const fracas = ordem.filter(i => pont[i] > 0)
  const nPalavras = n.split(' ').length
  if (fracas.length > 0 && (nPalavras <= 4 || fracas.length >= 2)) {
    return { tipo: 'ambigua', idioma, candidatas: fracas.slice(0, 3), textoNormalizado: n }
  }
  return { tipo: 'fora_ambito', idioma, textoNormalizado: n }
}

/** Implementação por defeito do contrato (local, síncrona por dentro). */
export const interpretadorInterno: InterpretadorPergunta = {
  interpretar: async texto => interpretar(texto),
}

/** Interpretação direta (cartões de perguntas rápidas): sem texto livre. */
export const interpretacaoDireta = (intencao: IntencaoId): Interpretacao => ({
  tipo: 'intencao', intencao, idioma: 'fr', horaFim: null, duracaoMin: null, ignoradas: [], falta: null, pontuacao: 99, textoNormalizado: '',
})
