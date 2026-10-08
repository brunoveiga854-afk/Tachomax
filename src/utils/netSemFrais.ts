// src/utils/netSemFrais.ts
// Separa os frais do net da IA SÓ quando a reconciliação é coerente E todas as
// salvaguardas passam. 'incluido' = "coerente e plausível", NÃO prova a natureza
// das rubricas. Em qualquer dúvida devolve o net recebido, inalterado.
// Nunca devolve zero por decisão própria. Não regista nada.

export type EstadoNetFrais = 'incluido' | 'excluido' | 'desconhecido' | 'frais_excedem_net'
export type ProvaNetFrais = {
  netSocial?: unknown      // net social lido na fiche (mensal)
  pas?: unknown            // PAS lido (> 0; 0 = ausente por defeito da IA)
  brut?: unknown           // salairebrut
  cotisations?: unknown    // totalCotisations
  primesNoNet?: unknown    // interessement + participationSalariale + primeExceptionnelle
}
export type ResultadoNetSemFrais = { valor: number; estado: EstadoNetFrais }

export const TOLERANCIA_EUR = 0.02              // S6
export const FRAIS_MAX_SOBRE_NET_SOCIAL = 0.6   // S2
export const MARGEM_NETSOCIAL_VS_BRUTCOT = 0.10 // S3 (±10 %)

const finito = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const soma0 = (v: unknown): number => finito(v) ?? 0
const arred2 = (v: number): number => Math.round(v * 100) / 100

// Lê a prova numa fiche com o mesmo padrão "dados || próprio" usado para netPaye.
export function provaDeFiche(dados: any, fiche?: any): ProvaNetFrais {
  const ler = (k: string) => dados?.[k] || fiche?.[k]
  return {
    netSocial: ler('netSocial'),
    pas: ler('pas'),
    brut: ler('salairebrut'),
    cotisations: ler('totalCotisations'),
    primesNoNet: soma0(ler('interessement')) + soma0(ler('participationSalariale')) + soma0(ler('primeExceptionnelle')),
  }
}

export function netSemFrais(
  netIA: unknown,
  frais: unknown,
  prova?: ProvaNetFrais | null,
): ResultadoNetSemFrais {
  const net = finito(netIA)
  const fr = finito(frais)
  const inalterado = net ?? 0

  if (net === null || net <= 0 || fr === null || fr < 0) return { valor: inalterado, estado: 'desconhecido' }
  if (fr === 0) return { valor: net, estado: 'excluido' }            // nada a subtrair
  if (fr >= net) return { valor: net, estado: 'frais_excedem_net' }  // nunca devolve zero

  const ns = finito(prova?.netSocial)
  const pas = finito(prova?.pas)
  const brut = finito(prova?.brut)
  const cot = finito(prova?.cotisations)
  const primes = finito(prova?.primesNoNet) ?? 0

  // S1 + S7: os dados têm de existir de facto (0 = ausente por defeito da IA)
  if (ns === null || ns <= 0 || pas === null || pas <= 0) return { valor: net, estado: 'desconhecido' }
  if (brut === null || brut <= 0 || cot === null || cot <= 0 || primes < 0) return { valor: net, estado: 'desconhecido' }
  // S2: plausibilidade dos frais
  if (fr > FRAIS_MAX_SOBRE_NET_SOCIAL * ns) return { valor: net, estado: 'desconhecido' }
  // S3: net social coerente com bruto − cotisações
  const ref = brut - cot
  if (ns < ref * (1 - MARGEM_NETSOCIAL_VS_BRUTCOT) || ns > ref * (1 + MARGEM_NETSOCIAL_VS_BRUTCOT) + primes)
    return { valor: net, estado: 'desconhecido' }

  const semFrais = net - fr
  // S4 + S5: o resultado tem de ser plausível e não rebentar o max(0, …) a jusante
  if (semFrais <= 0 || semFrais < primes || semFrais > brut + primes) return { valor: net, estado: 'desconhecido' }

  // S6: a conta fecha de exactamente um dos lados
  const fechaInclusao = Math.abs(net - (ns + fr - pas)) <= TOLERANCIA_EUR + 1e-9
  const fechaExclusao = Math.abs(net - (ns - pas)) <= TOLERANCIA_EUR + 1e-9
  if (fechaInclusao && !fechaExclusao) return { valor: arred2(semFrais), estado: 'incluido' }
  if (fechaExclusao && !fechaInclusao) return { valor: net, estado: 'excluido' }
  return { valor: net, estado: 'desconhecido' }
}
