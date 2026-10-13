// src/utils/rubricas.test.ts — Etapa 2A: normalizador/validador puro das rubricas
import {
  normalizarRespostaExtracao, normalizarRespostasExtracao, validarDocumentoRubricas, contarPorCategoria,
  lerNumero, sugerirCategoriaPorLibelle,
} from './rubricas'
import type { ProblemaDados } from '../types/rubricas'

const AGORA = '2026-10-13T10:00:00.000Z'
const opc = { agora: AGORA }

function congelar<T>(o: T): T {
  if (o && typeof o === 'object') { Object.values(o as object).forEach(congelar); Object.freeze(o) }
  return o
}
const cod = (ps: ProblemaDados[]) => ps.map(p => p.codigo)
const fiche = (lignes: unknown[], extra: Record<string, unknown> = {}) => ({ periode: 'Octobre 2026', moisIndex: 9, annee: 2026, lignes, ...extra })
const um = (l: Record<string, unknown>) => normalizarRespostaExtracao(fiche([l]), opc).linhas[0]

describe('1. base e equivalência são rubricas distintas', () => {
  it('152 h de base e 17 h de equivalência ficam em linhas e categorias separadas, sem fusão', () => {
    const d = normalizarRespostaExtracao(fiche([
      { libelle: 'Salaire de base', quantite: 152, unite: 'h', taux: 12.5, montant: 1900 },
      { libelle: "Heures d'équivalence", quantite: 17, unite: 'h', taux: 12.5, montant: 212.5 },
    ]), opc)
    expect(d.linhas.length).toBe(2)
    expect(d.linhas[0].classificacao.categoria).toBe('salaire_base')
    expect(d.linhas[1].classificacao.categoria).toBe('heures_equivalence')
    expect(d.linhas[0].quantidade).toBe(152)
    expect(d.linhas[1].quantidade).toBe(17)
    expect(d.linhas[0].id).not.toBe(d.linhas[1].id)
  })
})

describe('2. escalões de horas suplementares distintos', () => {
  it('25 % e 50 % ficam em linhas separadas com subcategoria sugerida', () => {
    const d = normalizarRespostaExtracao(fiche([
      { libelle: 'Heures supplémentaires 25%', quantite: 8, taux: 15, montant: 120 },
      { libelle: 'Heures supplémentaires 50%', quantite: 4, taux: 18, montant: 72 },
    ]), opc)
    expect(d.linhas.length).toBe(2)
    expect(d.linhas[0].classificacao.categoria).toBe('heures_supplementaires')
    expect(d.linhas[0].classificacao.subcategoria).toBe('majoracao_25')
    expect(d.linhas[1].classificacao.subcategoria).toBe('majoracao_50')
    expect(d.linhas[0].taxa).toBe(15)
    expect(d.linhas[1].taxa).toBe(18)
  })
})

describe('3. trabalho de noite', () => {
  it('categoria travail_nuit sugerida pelo libellé, nunca confirmada', () => {
    const l = um({ libelle: 'Heures de nuit', quantite: 20, taux: 1.2, montant: 24 })
    expect(l.classificacao.categoria).toBe('travail_nuit')
    expect(l.classificacao.estado).toBe('sugerida')
    expect(l.classificacao.origem).toBe('regra')
  })
})

describe('4. congés payés com retenção e indemnização', () => {
  it('retenção e indemnização são linhas distintas da mesma categoria; coluna e sinal preservados', () => {
    const d = normalizarRespostaExtracao(fiche([
      { libelle: 'Congés payés retenue', quantite: 5, taux: 100, montant: -500, colonne: 'retenue' },
      { libelle: 'Indemnité congés payés', quantite: 5, taux: 110, montant: 550, colonne: 'gain' },
    ]), opc)
    expect(d.linhas[0].classificacao.categoria).toBe('conges_payes')
    expect(d.linhas[0].classificacao.subcategoria).toBe('retenue')
    expect(d.linhas[0].coluna).toBe('retenue')
    expect(d.linhas[0].montante).toBe(-500)
    expect(d.linhas[0].sinal).toBe('negativo')
    expect(d.linhas[1].classificacao.categoria).toBe('conges_payes')
    expect(d.linhas[1].classificacao.subcategoria).toBe('indemnite')
    expect(d.linhas[1].coluna).toBe('gain')
    expect(d.linhas[1].sinal).toBe('positivo')
  })
})

describe('5. feriados e repos compensateur', () => {
  it('categorias separadas', () => {
    const d = normalizarRespostaExtracao(fiche([
      { libelle: 'Jours fériés travaillés', quantite: 1, montant: 100 },
      { libelle: 'Repos compensateur', quantite: 7, unite: 'h', montant: 90 },
    ]), opc)
    expect(d.linhas[0].classificacao.categoria).toBe('jours_feries')
    expect(d.linhas[1].classificacao.categoria).toBe('repos_compensateur')
  })
})

describe('6. montantes negativos e colunas de retenção', () => {
  it('montante negativo preservado; não se assume que tudo é ganho', () => {
    const l = um({ libelle: 'Régularisation acompte', montant: -75.4, colonne: 'gain' })
    expect(l.montante).toBe(-75.4)
    expect(l.sinal).toBe('negativo')
  })
  it('coluna de retenção reconhecida; cotisações não são tratadas como ganho', () => {
    const l = um({ libelle: 'CSG déductible', base: 2000, taux: 6.8, montant: 136, colonne: 'Retenue salariale' })
    expect(l.coluna).toBe('retenue')
    expect(l.classificacao.categoria).toBe('cotisation_retenue')
  })
  it('sens contraditório com o montante impresso: aviso, montante intacto', () => {
    const l = um({ libelle: 'Ajustement', montant: 50, sens: '-' })
    expect(l.montante).toBe(50)
    expect(l.sinal).toBe('positivo')
    expect(cod(l.problemas)).toContain('sinal_inconsistente')
  })
  it('sem montante, o sinal vem de sens; sem sens fica desconhecido', () => {
    expect(um({ libelle: 'X', sens: '-' }).sinal).toBe('negativo')
    expect(um({ libelle: 'X' }).sinal).toBe('desconhecido')
  })
})

describe('7. ausente ≠ zero', () => {
  it('valores não impressos ficam null; 0 impresso continua 0', () => {
    const l = um({ libelle: 'Prime panier', quantite: 0, montant: 0 })
    expect(l.quantidade).toBe(0)
    expect(l.montante).toBe(0)
    expect(l.sinal).toBe('zero')
    expect(l.taxa).toBe(null)
    expect(l.base).toBe(null)
    expect(l.unidade).toBe(null)
    expect(l.periodo).toBe(null)
  })
  it('totais ausentes ficam null', () => {
    const d = normalizarRespostaExtracao(fiche([{ libelle: 'A' }], { totaux: { brut: 2500 } }), opc)
    expect(d.totaisImpressos.brut).toBe(2500)
    expect(d.totaisImpressos.netPaye).toBe(null)
    expect(d.totaisImpressos.pas).toBe(null)
  })
  it('números inválidos viram null com erro, nunca 0', () => {
    const ps: ProblemaDados[] = []
    expect(lerNumero('abc', 'x', ps)).toBe(null)
    // 2C: «1.234,56» passou a ser aceite (inequívoco); ver rubricasNumeros.test.ts. Aqui ficam os inválidos.
    expect(lerNumero('1.234', 'x', ps)).toBe(null)
    expect(lerNumero(NaN, 'x', ps)).toBe(null)
    expect(lerNumero('12,5 €', 'x', ps)).toBe(12.5)
    expect(lerNumero('', 'x', ps)).toBe(null)
    expect(cod(ps).filter(c => c === 'numero_invalido').length).toBe(3)
  })
})

describe('8. rubricas desconhecidas', () => {
  it('aceita rubrica sem classificação: inconnue / nao_classificada / origem nenhuma', () => {
    const l = um({ libelle: 'Truc spécial XYZ', montant: 33 })
    expect(l.classificacao.categoria).toBe('inconnue')
    expect(l.classificacao.estado).toBe('nao_classificada')
    expect(l.classificacao.origem).toBe('nenhuma')
    expect(l.libelleOriginal).toBe('Truc spécial XYZ')
  })
  it('libellé ambíguo não é adivinhado', () => {
    expect(sugerirCategoriaPorLibelle('Prime nuit')).toBe(null)
    const l = um({ libelle: 'Prime nuit', montant: 10 })
    expect(l.classificacao.estado).toBe('nao_classificada')
  })
  it('categoria da IA não reconhecida: preservada e avisada', () => {
    const l = um({ libelle: 'Bidule', categorie: 'coisa_estranha', montant: 1 })
    expect(l.classificacao.categoriaBruta).toBe('coisa_estranha')
    expect(l.classificacao.estado).toBe('nao_classificada')
    expect(cod(l.problemas)).toContain('categoria_nao_reconhecida')
  })
  it('campos desconhecidos da linha, do documento e dos totais são preservados', () => {
    const d = normalizarRespostaExtracao(fiche([{ libelle: 'A', montant: 1, codeRubrique: '0123', extra: { a: 1 } }],
      { totaux: { brut: 1, netSocial2: 5 }, observacao: 'x' }), opc)
    expect(d.linhas[0].desconhecidos.codeRubrique).toBe('0123')
    expect((d.linhas[0].desconhecidos.extra as any).a).toBe(1)
    expect(d.totaisImpressos.desconhecidos.netSocial2).toBe(5)
    expect(d.desconhecidos.observacao).toBe('x')
  })
})

describe('9. duas linhas com o mesmo libellé', () => {
  it('ambas mantidas, ids distintos, a repetição só é assinalada (info)', () => {
    const d = normalizarRespostaExtracao(fiche([
      { libelle: 'Prime exceptionnelle', montant: 100 },
      { libelle: 'Prime exceptionnelle', montant: 100 },
      { libelle: 'Prime exceptionnelle', montant: 40 },
    ]), opc)
    expect(d.linhas.length).toBe(3)
    expect(new Set(d.linhas.map(l => l.id)).size).toBe(3)
    expect(d.linhas.map(l => l.ordem)).toEqual([1, 2, 3])
    expect(cod(d.linhas[1].problemas)).toContain('linha_repetida')
    expect(cod(d.linhas[0].problemas)).not.toContain('linha_repetida')
    expect(d.linhas[1].problemas.find(p => p.codigo === 'linha_repetida')!.gravidade).toBe('info')
  })
})

describe('10. valores e períodos inconsistentes', () => {
  it('quantidade × taxa ≠ montante: aviso, nada corrigido', () => {
    const l = um({ libelle: 'Heures supplémentaires 25%', quantite: 8, taux: 15, montant: 999 })
    expect(cod(l.problemas)).toContain('montante_inconsistente')
    expect(l.montante).toBe(999)
    expect(l.quantidade).toBe(8)
  })
  it('valores coerentes não geram aviso', () => {
    const l = um({ libelle: 'Heures supplémentaires 25%', quantite: 8, taux: 15, montant: 120 })
    expect(cod(l.problemas)).not.toContain('montante_inconsistente')
  })
  it('período invertido: aviso, datas preservadas como lidas', () => {
    const l = um({ libelle: 'A', montant: 1, periode: 'du 31/10/2026 au 01/10/2026' })
    expect(cod(l.problemas)).toContain('periodo_invertido')
    expect(l.periodo!.de).toBe('2026-10-31')
    expect(l.periodo!.ate).toBe('2026-10-01')
  })
  it('período não interpretável: texto preservado, periodo null', () => {
    const l = um({ libelle: 'A', montant: 1, periode: 'semaine 3' })
    expect(l.periodoTexto).toBe('semaine 3')
    expect(l.periodo).toBe(null)
    expect(cod(l.problemas)).toContain('periodo_nao_interpretado')
  })
  it('data impossível (31/02) não é inventada', () => {
    const l = um({ libelle: 'A', montant: 1, periode: '31/02/2026' })
    expect(l.periodo).toBe(null)
  })
  it('período do documento: moisIndex fora de 0-11 e texto divergente assinalados', () => {
    const a = normalizarRespostaExtracao(fiche([{ libelle: 'A' }], { moisIndex: 14 }), opc)
    expect(cod(a.problemas)).toContain('mes_invalido')
    const b = normalizarRespostaExtracao(fiche([{ libelle: 'A' }], { periode: 'Septembre 2026' }), opc)
    expect(cod(b.problemas)).toContain('periodo_inconsistente')
    expect(b.periodoDocumento.mes).toBe(9)
    expect(b.periodoDocumento.texto).toBe('Septembre 2026')
  })
  it('linha sem libellé é assinalada, não inventada', () => {
    const l = um({ montant: 5 })
    expect(l.libelleOriginal).toBe('')
    expect(cod(l.problemas)).toContain('libelle_ausente')
  })
})

describe('11. preservação dos dados originais', () => {
  it('não muta a entrada (profundamente congelada) e não partilha referências', () => {
    const entrada = congelar(fiche([
      { libelle: '  Salaire de base  ', quantite: 152, montant: 1900, extra: { x: [1, 2] } },
    ], { totaux: { brut: 1, z: { k: 1 } }, nota: { a: 1 } }))
    const copia = JSON.stringify(entrada)
    const d = normalizarRespostaExtracao(entrada, opc)
    expect(JSON.stringify(entrada)).toBe(copia)
    expect(d.linhas[0].libelleOriginal).toBe('  Salaire de base  ')
    expect(d.linhas[0].desconhecidos.extra).not.toBe((entrada.lignes[0] as any).extra)
    expect(d.desconhecidos.nota).not.toBe((entrada as any).nota)
  })
  it('libellé nunca reescrito (maiúsculas, acentos, espaços)', () => {
    const l = um({ libelle: 'HEURES  SUPPLÉMENTAIRES   25 %', montant: 1 })
    expect(l.libelleOriginal).toBe('HEURES  SUPPLÉMENTAIRES   25 %')
  })
  it('todas as rubricas são «documentais» e sem estimativas', () => {
    const d = normalizarRespostaExtracao(fiche([{ libelle: 'A', montant: 1 }, { libelle: 'B' }]), opc)
    expect(d.linhas.every(l => l.natureza === 'documental' && l.estimativas.length === 0)).toBe(true)
  })
  it('entradas inválidas não rebentam e nada é descartado em silêncio', () => {
    const d = normalizarRespostaExtracao(fiche(['texto solto', null, 5]), opc)
    expect(d.linhas.length).toBe(3)
    expect(cod(d.linhas[0].problemas)).toContain('linha_invalida')
    expect(d.linhas[0].desconhecidos.valorOriginal).toBe('texto solto')
    const e = normalizarRespostaExtracao(null, opc)
    expect(cod(e.problemas)).toContain('resposta_invalida')
    expect(e.linhas.length).toBe(0)
    const lote = normalizarRespostasExtracao([fiche([{ libelle: 'A' }]), 'x', null], opc)
    expect(lote.documentos.length).toBe(1)
    expect(lote.ignoradas.length).toBe(2)
    expect(normalizarRespostasExtracao({}, opc).ignoradas.length).toBe(1)
  })
})

describe('12. nunca confirma automaticamente', () => {
  it('sugestões da IA e das regras ficam «sugerida»; indicação de confirmação é ignorada', () => {
    const d = normalizarRespostaExtracao(fiche([
      { libelle: 'Salaire de base', categorie: 'salaire_base', confiance: 0.99, confirmada: true, estadoClassificacao: 'confirmada' },
      { libelle: 'Heures de nuit', montant: 3 },
      { libelle: 'Outra', categorie: 'prime', confiance: 1 },
    ]), opc)
    expect(d.linhas.every(l => l.classificacao.estado !== 'confirmada')).toBe(true)
    expect(d.linhas[0].classificacao.origem).toBe('ia')
    expect(d.linhas[0].classificacao.estado).toBe('sugerida')
    expect(cod(d.linhas[0].problemas)).toContain('confirmacao_ignorada')
    expect(d.linhas[0].desconhecidos.confirmada).toBe(true)
    expect(d.estado).toBe('extraido')
    const c = contarPorCategoria(d)
    expect(c.confirmadas).toBe(0)
    expect(c.porClassificar).toBe(3)
  })
  it('confiança fora de [0,1] é ignorada com aviso', () => {
    const l = um({ libelle: 'A', categorie: 'prime', confiance: 7 })
    expect(l.classificacao.confianca).toBe(null)
    expect(cod(l.problemas)).toContain('confianca_fora_de_intervalo')
  })
  it('regras de libellé podem ser desligadas', () => {
    const d = normalizarRespostaExtracao(fiche([{ libelle: 'Heures de nuit' }]), { ...opc, usarRegrasLibelle: false })
    expect(d.linhas[0].classificacao.estado).toBe('nao_classificada')
  })
  it('categorias da IA (inclusive «inconnue») cobrem as 13 categorias', () => {
    const cats = ['salaire_base', 'heures_equivalence', 'heures_supplementaires', 'travail_nuit', 'conges_payes', 'jours_feries',
      'repos_compensateur', 'arret_maladie', 'autres_absences', 'prime', 'regularisation', 'cotisation_retenue', 'inconnue']
    const d = normalizarRespostaExtracao(fiche(cats.map((c, i) => ({ libelle: `L${i}`, categorie: c }))), opc)
    expect(d.linhas.map(l => l.classificacao.categoria)).toEqual(cats)
    expect(d.linhas[12].classificacao.estado).toBe('nao_classificada')
    expect(d.linhas[0].classificacao.estado).toBe('sugerida')
  })
})

describe('13. identidade estável, não só pelo mês', () => {
  const base = [{ libelle: 'Salaire de base', quantite: 152, montant: 1900 }]
  it('o mesmo conteúdo dá o mesmo id (determinista)', () => {
    const a = normalizarRespostaExtracao(fiche(base), opc)
    const b = normalizarRespostaExtracao(fiche(base), { agora: '2030-01-01T00:00:00.000Z' })
    expect(a.idDocumento).toBe(b.idDocumento)
    expect(a.origemId).toBe('conteudo')
    expect(a.linhas[0].id).toBe(b.linhas[0].id)
  })
  it('dois documentos do MESMO mês com conteúdos diferentes têm ids diferentes', () => {
    const a = normalizarRespostaExtracao(fiche(base), opc)
    const b = normalizarRespostaExtracao(fiche([{ libelle: 'Salaire de base', quantite: 151, montant: 1890 }]), opc)
    expect(a.idDocumento).not.toBe(b.idDocumento)
  })
  it('id fornecido tem prioridade; hash vem depois', () => {
    const a = normalizarRespostaExtracao(fiche(base, { idDocumento: 'meu-id', hash: 'abc' }), opc)
    expect(a.idDocumento).toBe('meu-id')
    expect(a.origemId).toBe('fornecido')
    const b = normalizarRespostaExtracao(fiche(base, { hash: 'abc' }), opc)
    expect(b.origemId).toBe('hash_documento')
    expect(b.hashDocumento).toBe('abc')
    expect(b.idDocumento.indexOf('doc-')).toBe(0)
  })
  it('ids das linhas incluem o id do documento e a ordem', () => {
    const d = normalizarRespostaExtracao(fiche(base, { idDocumento: 'D1' }), opc)
    expect(d.linhas[0].id.indexOf('D1#1-')).toBe(0)
  })
  it('modelo e versão do prompt: do documento, senão das opções, senão null', () => {
    const a = normalizarRespostaExtracao(fiche(base, { modele: 'm1', versionPrompt: 'p1' }), { ...opc, modeloIA: 'x', versaoPrompt: 'y' })
    expect(a.modeloIA).toBe('m1'); expect(a.versaoPrompt).toBe('p1')
    const b = normalizarRespostaExtracao(fiche(base), { ...opc, modeloIA: 'x', versaoPrompt: 'y' })
    expect(b.modeloIA).toBe('x'); expect(b.versaoPrompt).toBe('y')
    const c = normalizarRespostaExtracao(fiche(base), opc)
    expect(c.modeloIA).toBe(null)
    expect(c.importadoEm).toBe(AGORA)
  })
})

describe('14. validarDocumentoRubricas', () => {
  const ok = () => normalizarRespostaExtracao(fiche([
    { libelle: 'Salaire de base', quantite: 152, montant: 1900 }, { libelle: 'Salaire de base', quantite: 152, montant: 1900 },
  ]), opc)
  it('documento normalizado é coerente', () => {
    expect(validarDocumentoRubricas(ok()).length).toBe(0)
  })
  it('detecta confirmação sem origem «utilizador»', () => {
    const d: any = JSON.parse(JSON.stringify(ok()))
    d.linhas[0].classificacao.estado = 'confirmada'
    expect(cod(validarDocumentoRubricas(d))).toContain('confirmacao_sem_utilizador')
    d.linhas[0].classificacao.origem = 'utilizador'
    expect(cod(validarDocumentoRubricas(d))).not.toContain('confirmacao_sem_utilizador')
  })
  it('detecta ids repetidos, ordem incoerente, números não finitos e categoria inválida, sem corrigir', () => {
    const d: any = JSON.parse(JSON.stringify(ok()))
    d.linhas[1].id = d.linhas[0].id
    d.linhas[1].ordem = 7
    d.linhas[0].montante = 'abc'
    d.linhas[0].classificacao.categoria = 'xpto'
    const antes = JSON.stringify(d)
    const c = cod(validarDocumentoRubricas(d))
    expect(c).toContain('id_duplicado')
    expect(c).toContain('ordem_incoerente')
    expect(c).toContain('numero_invalido')
    expect(c).toContain('categoria_invalida')
    expect(JSON.stringify(d)).toBe(antes)
  })
  it('lixo não rebenta', () => {
    expect(cod(validarDocumentoRubricas(null))).toContain('documento_invalido')
    expect(cod(validarDocumentoRubricas({ versaoEsquema: 1, idDocumento: 'a', estado: 'extraido', linhas: 5 }))).toContain('linhas_invalidas')
  })
  it('estimativas têm de ser explícitas e finitas (documental ≠ estimado)', () => {
    const d: any = JSON.parse(JSON.stringify(ok()))
    d.linhas[0].estimativas = [{ valor: NaN, origem: 'motor' }]
    expect(cod(validarDocumentoRubricas(d))).toContain('estimativa_invalida')
    d.linhas[0].natureza = 'estimada'
    expect(cod(validarDocumentoRubricas(d))).toContain('natureza_invalida')
  })
})
