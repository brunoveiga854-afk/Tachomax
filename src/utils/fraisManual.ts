// src/utils/fraisManual.ts
// Frais ajustados À MÃO pelo motorista: decisão pura e testável de quando um valor de frais passa a «manual»
// (marca `fraisManual:true` no registo) e quando uma edição pode, ou não, recalculá-lo.
//
// Princípios:
//   • um valor confirmado pelo motorista NUNCA é substituído em silêncio por um recálculo;
//   • só deixa de ser manual se o motorista voltar ao valor automático OU alterar os dados de que o cálculo depende
//     (tipo, início, fim, tempo de serviço, découché) — nesse caso o valor novo é visível no ecrã/registado em log;
//   • dados antigos (sem a marca) continuam a comportar-se exactamente como antes.
const IGUAL = (a: number, b: number) => Math.abs(a - b) < 0.005

export type OrigemFrais = { frais: number; manual: boolean } | null

/**
 * Formulário da Home. `orig` = valor/estado do registo aberto para edição (null = registo novo);
 * `auto` = último cálculo automático mostrado no formulário (null = nunca calculado).
 */
export function decidirFraisManualForm(valor: number, orig: OrigemFrais, auto: number | null): boolean {
  if (orig && IGUAL(orig.frais, valor)) return orig.manual          // não mexeu no valor: mantém o estado que tinha
  if (auto !== null && Number.isFinite(auto)) return !IGUAL(auto, valor)   // igual ao automático = não é ajuste manual
  return orig ? true : valor > 0                                    // sem cálculo de referência: um valor escrito à mão é manual
}

export type CamposFrais = { type?: string; debut?: string; fin?: string; segServico?: number; decouche?: boolean }
const norm = (c: CamposFrais) => ({
  type: String(c.type ?? 'TRAB'), debut: String(c.debut ?? ''), fin: String(c.fin ?? ''),
  seg: Math.round((Number(c.segServico) || 0) / 60), dec: !!c.decouche,
})

export type DecisaoFraisEdicao = { frais: number; fraisManual: boolean; motivo: 'sem_manual' | 'manual_preservado' | 'recalculado_por_alteracao' }

/** Historique `guardarEdicao`: mantém o frais manual se nada do que o determina mudou; senão recalcula (e perde a marca). */
export function decidirFraisEdicao(
  antes: CamposFrais & { frais?: number; fraisManual?: boolean },
  depois: CamposFrais,
  recalculado: number,
): DecisaoFraisEdicao {
  if (antes.fraisManual !== true) return { frais: recalculado, fraisManual: false, motivo: 'sem_manual' }
  const a = norm(antes), d = norm(depois)
  const igual = a.type === d.type && a.debut === d.debut && a.fin === d.fin && a.seg === d.seg && a.dec === d.dec
  if (igual) return { frais: Number(antes.frais) || 0, fraisManual: true, motivo: 'manual_preservado' }
  return { frais: recalculado, fraisManual: false, motivo: 'recalculado_por_alteracao' }
}
