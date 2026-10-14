// src/utils/extracaoRubricas.test.ts — Etapa 2C: perfis fictícios, truncagem, fallback legado, isolamento
import * as fs from 'fs'
import * as path from 'path'
import { prepararExtracaoRubricas, rotuloModoExtracao, camposLegadosDe, problemaCamposLegados, type TentativaDetalhada, type ExtracaoPreparada } from './extracaoRubricas'
import { contarPorCategoria, validarDocumentoRubricas } from './rubricas'
import { chavesLegadasDoPrompt, PROMPT_FICHES_LEGADO } from './promptRubricas'
import { actualizarPadraoComBoletim, PADRAO_INICIAL, type BoletimExtraido } from '../engine/aprendizagem'
import {
  PERFIL_A, PERFIL_B, PERFIL_C, PERFIS, montarFicheDetalhada, textoResposta, respostaAPI, type Obj, type PerfilFicticio, type OpcoesFiche,
} from './rubricasFixtures'

const AGORA = '2026-10-13T10:00:00.000Z'
const opc = { agora: AGORA }
const api = (p: PerfilFicticio, o: OpcoesFiche = {}, stop: string | null = 'end_turn'): TentativaDetalhada =>
  ({ tipo: 'api', data: respostaAPI(textoResposta([montarFicheDetalhada(p, o)]), stop) })
const doc = (e: ExtracaoPreparada, i = 0) => e.documentos[i]
const deepFreeze = <T>(o: T): T => { if (o && typeof o === 'object') { Object.values(o as object).forEach(deepFreeze); Object.freeze(o) } return o }
const RAIZ = path.join(__dirname, '../..')
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n')

describe('1. três perfis fictícios → estrutura verificada, libellés e linhas intactos', () => {
  for (const p of PERFIS) {
    it(`${p.nome}: todas as linhas, na ordem, com o libellé exato`, () => {
      const e = prepararExtracaoRubricas(api(p), opc)
      expect(e.decisao.acao).toBe('usar_detalhada')
      expect(e.decisao.modo).toBe('detalhada_estrutura_verificada')
      expect(e.decisao.garantiaLeituraCompleta).toBe(false)
      expect(e.documentos.length).toBe(1)
      expect(doc(e).linhas.map(l => l.libelleOriginal)).toEqual(p.linhas.map(l => l.libelle))
      expect(doc(e).linhas.map(l => l.ordem)).toEqual(p.linhas.map((_, i) => i + 1))
      expect(doc(e).completude!.estado).toBe('completo_estrutural')
      expect(doc(e).completude!.garantiaLeituraCompleta).toBe(false)
      expect(validarDocumentoRubricas(doc(e))).toEqual([])
    })
  }
  it('o rótulo da estrutura verificada nunca diz que tudo foi lido', () => {
    const r = rotuloModoExtracao('detalhada_estrutura_verificada')
    expect(r.includes('não garante')).toBe(true)
    expect(/completa/i.test(r.replace('não garante', ''))).toBe(false)
  })
})

describe('2. contratos diferentes sem valores fixos no código', () => {
  const cats = (p: PerfilFicticio) => contarPorCategoria(doc(prepararExtracaoRubricas(api(p), opc))).porCategoria
  it('A tem equivalência; B e C não — o normalizador não inventa nem remove linhas', () => {
    expect(cats(PERFIL_A).heures_equivalence).toBe(1)
    expect(cats(PERFIL_B).heures_equivalence).toBe(0)
    expect(cats(PERFIL_C).heures_equivalence).toBe(0)
    for (const p of PERFIS) expect(doc(prepararExtracaoRubricas(api(p), opc)).linhas.length).toBe(p.linhas.length)
  })
  it('A: base e equivalência separadas; suplementares 25/50 e noite separadas', () => {
    const d = doc(prepararExtracaoRubricas(api(PERFIL_A), opc))
    expect(d.linhas[0].classificacao.categoria).toBe('salaire_base')
    expect(d.linhas[1].classificacao.categoria).toBe('heures_equivalence')
    expect(d.linhas[2].classificacao.subcategoria).toBe('majoracao_25')
    expect(d.linhas[3].classificacao.subcategoria).toBe('majoracao_50')
    expect(d.linhas[4].classificacao.categoria).toBe('travail_nuit')
    expect(d.linhas[8].coluna).toBe('patronal')
    expect(d.linhas[0].quantidade).toBe(PERFIL_A.linhas[0].quantite)
    expect(d.linhas[1].quantidade).toBe(PERFIL_A.linhas[1].quantite)
  })
  it('B: congés com dedução (negativa) e indemnização; baixa; regularização negativa; rubrica desconhecida', () => {
    const d = doc(prepararExtracaoRubricas(api(PERFIL_B), opc))
    const cp = d.linhas.filter(l => l.classificacao.categoria === 'conges_payes')
    expect(cp.map(l => l.classificacao.subcategoria)).toEqual(['retenue', 'indemnite'])
    expect(cp[0].montante).toBe(-450)
    expect(cp[0].coluna).toBe('retenue')
    expect(cp[1].montante).toBe(492.5)
    expect(d.linhas.filter(l => l.classificacao.categoria === 'arret_maladie')[0].montante).toBe(-270)
    const reg = d.linhas.filter(l => l.classificacao.categoria === 'regularisation')[0]
    expect(reg.montante).toBe(-35.6)
    expect(reg.sinal).toBe('negativo')
    const inc = d.linhas.find(l => l.libelleOriginal === 'Subrogation IJSS')!
    expect(inc.classificacao.categoria).toBe('inconnue')
    expect(inc.classificacao.estado).toBe('nao_classificada')
    expect(inc.montante).toBe(180)
  })
  it('C: fériés, RC, prémios, repetidas, desconhecidas e formatos franceses', () => {
    const d = doc(prepararExtracaoRubricas(api(PERFIL_C), opc))
    const c = contarPorCategoria(d).porCategoria
    expect(c.jours_feries).toBe(1)
    expect(c.repos_compensateur).toBe(1)
    expect(c.prime).toBe(3)
    expect(d.linhas[1].montante).toBe(171)           // «171,00»
    expect(d.linhas[3].montante).toBe(1234.56)       // «1 234,56» com espaço inseparável estreito
    expect(d.linhas[6].montante).toBe(-12.5)         // «12,50-»
    expect(d.linhas[7].montante).toBe(-75.4)         // «(75,40)»
    expect(d.linhas[8].montante).toBe(1234.56)       // «1.234,56»
    expect(d.linhas[6].problemas.map(p => p.codigo)).toContain('negativo_por_formato')
    expect(d.linhas[7].problemas.map(p => p.codigo)).toContain('negativo_por_formato')
  })
})

describe('3. valores nulos, zero e negativos', () => {
  const d = doc(prepararExtracaoRubricas(api(PERFIL_C), opc))
  it('«0» impresso fica 0 (sinal zero); não impresso fica null (sinal desconhecido) — nunca se confundem', () => {
    expect(d.linhas[4].montante).toBe(0)
    expect(d.linhas[4].sinal).toBe('zero')
    const sem = d.linhas[9]
    expect(sem.libelleOriginal).toBe('Ajust. div. 7')
    expect(sem.montante).toBeNull()
    expect(sem.quantidade).toBeNull()
    expect(sem.taxa).toBeNull()
    expect(sem.base).toBeNull()
    expect(sem.sinal).toBe('desconhecido')
  })
  it('totais não impressos ficam null', () => {
    expect(d.totaisImpressos.brut).toBe(PERFIL_C.totaux.brut)
    expect(d.totaisImpressos.netPaye).toBe(PERFIL_C.totaux.netPaye)
    expect(d.totaisImpressos.pas).toBeNull()
    expect(d.totaisImpressos.netSocial).toBeNull()
  })
  it('negativos preservados com a coluna original (retenue)', () => {
    for (const i of [6, 7]) { expect(d.linhas[i].montante! < 0).toBe(true); expect(d.linhas[i].coluna).toBe('retenue') }
  })
})

describe('4. rubricas repetidas', () => {
  it('«Prime panier» ×2 → duas linhas, ids distintos, repetição só assinalada (info)', () => {
    const d = doc(prepararExtracaoRubricas(api(PERFIL_C), opc))
    const ps = d.linhas.filter(l => l.libelleOriginal === 'Prime panier')
    expect(ps.length).toBe(2)
    expect(ps[0].id === ps[1].id).toBe(false)
    expect(ps[1].problemas.map(p => p.codigo)).toContain('linha_repetida')
    expect(ps[1].problemas.find(p => p.codigo === 'linha_repetida')!.gravidade).toBe('info')
    expect(d.completude!.nLinhas).toBe(PERFIL_C.linhas.length)
  })
})

describe('5. extração incompleta → fallback legado indicado; linhas parciais conservadas e nunca confirmadas', () => {
  const t = textoResposta([montarFicheDetalhada(PERFIL_A)])
  const cortada = (idx: number, stop: string | null = 'max_tokens'): TentativaDetalhada => ({ tipo: 'texto', texto: t.slice(0, idx), stopReason: stop })
  const meio = t.indexOf('"libelle":"Heures supplémentaires 50%"') + 12
  it('truncada a meio de uma linha: usar extração antiga, modo «legado» (nunca «detalhada»)', () => {
    const e = prepararExtracaoRubricas(cortada(meio), opc)
    expect(e.decisao.acao).toBe('usar_legado')
    expect(e.decisao.modo).toBe('legado')
    expect(e.decisao.codigo).toBe('extracao_incompleta')
    expect(e.decisao.conservarRubricasParciais).toBe(true)
    expect(e.decisao.rubricasDisponiveis).toBe(true)
    expect(e.decisao.garantiaLeituraCompleta).toBe(false)
    expect(rotuloModoExtracao(e.decisao.modo).toLowerCase().includes('detalhada')).toBe(false)
  })
  it('as 3 linhas recuperadas ficam marcadas como incompletas, com problema «extracao_incompleta»', () => {
    const e = prepararExtracaoRubricas(cortada(meio), opc)
    expect(doc(e).linhas.length).toBe(3)
    expect(doc(e).completude!.estado).toBe('incompleto')
    expect(doc(e).completude!.parcial).toBe(true)
    expect(doc(e).problemas.map(p => p.codigo)).toContain('extracao_incompleta')
    expect(validarDocumentoRubricas(doc(e))).toEqual([])
  })
  it('nada é confirmado automaticamente, nem nas linhas parciais', () => {
    for (const e of [prepararExtracaoRubricas(cortada(meio), opc), ...PERFIS.map(p => prepararExtracaoRubricas(api(p), opc))]) {
      for (const d of e.documentos) {
        expect(d.estado).toBe('extraido')
        for (const l of d.linhas) {
          expect(l.classificacao.estado === 'confirmada').toBe(false)
          expect(l.classificacao.origem === 'utilizador').toBe(false)
        }
      }
    }
  })
  it('cinco cortes diferentes: sempre fallback; nenhum declarado completo', () => {
    const cortes = [
      t.indexOf('"netPaye"') + 6,
      t.indexOf('"lignes":[') + 10,
      meio,
      t.indexOf(JSON.stringify({ n: 5, ...PERFIL_A.linhas[4] })) + JSON.stringify({ n: 5, ...PERFIL_A.linhas[4] }).length + 1,
      t.indexOf('],"fin":true') + 1,
    ]
    for (const c of cortes) {
      const e = prepararExtracaoRubricas(cortada(c, 'end_turn'), opc)
      expect(e.decisao.acao).toBe('usar_legado')
      expect(e.decisao.modo).toBe('legado')
      expect(e.completude.estado === 'completo_estrutural').toBe(false)
    }
  })
  it('JSON perfeito mas stop_reason = max_tokens → fallback', () => {
    const e = prepararExtracaoRubricas(api(PERFIL_B, {}, 'max_tokens'), opc)
    expect(e.decisao.acao).toBe('usar_legado')
    expect(e.decisao.modo).toBe('legado')
  })
  it('resposta no formato antigo (sem lignes) → fallback, sem rubricas', () => {
    const e = prepararExtracaoRubricas(api(PERFIL_A, { semDetalhe: true }), opc)
    expect(e.decisao.acao).toBe('usar_legado')
    expect(e.decisao.rubricasDisponiveis).toBe(false)
    expect(e.decisao.conservarRubricasParciais).toBe(false)
  })
  it('estrutura não verificável (sem nbLignes) → fallback, «completude_desconhecida»', () => {
    const e = prepararExtracaoRubricas(api(PERFIL_A, { omitirNbLignes: true }), opc)
    expect(e.decisao.acao).toBe('usar_legado')
    expect(e.decisao.codigo).toBe('completude_desconhecida')
    expect(doc(e).problemas.map(p => p.codigo)).toContain('completude_desconhecida')
  })
  it('estrutura perfeita mas campos legados inválidos (mês 14) → fallback', () => {
    const mau: PerfilFicticio = { ...PERFIL_A, legado: { ...PERFIL_A.legado, moisIndex: 14 } }
    const e = prepararExtracaoRubricas(api(mau), opc)
    expect(e.completude.estado).toBe('completo_estrutural')
    expect(e.decisao.acao).toBe('usar_legado')
    expect(e.decisao.codigo).toBe('campos_legados_invalidos')
    expect(problemaCamposLegados(mau.legado)).toBe('moisIndex inválido')
    expect(problemaCamposLegados(PERFIL_A.legado)).toBeNull()
  })
})

describe('6. decisão de fallback perante erros (sem rede nesta etapa)', () => {
  const erro = (categoria: 'rede' | 'timeout' | 'http' | 'sem_conteudo' | 'outro', status?: number, legadoJaTentado = false) =>
    prepararExtracaoRubricas({ tipo: 'erro', categoria, status }, { ...opc, legadoJaTentado })
  it('rede, timeout, 5xx, 400, sem conteúdo → usar a extração antiga', () => {
    for (const [c, s] of [['rede', undefined], ['timeout', undefined], ['http', 500], ['http', 400], ['http', 429], ['sem_conteudo', undefined], ['outro', undefined]] as const) {
      const e = erro(c, s)
      expect(e.decisao.acao).toBe('usar_legado')
      expect(e.decisao.modo).toBe('legado')
      expect(e.decisao.rubricasDisponiveis).toBe(false)
      expect(e.documentos).toEqual([])
    }
  })
  it('401, 403 e 413 → falhar (a extração antiga receberia o mesmo erro)', () => {
    for (const s of [401, 403, 413]) { const e = erro('http', s); expect(e.decisao.acao).toBe('falhar'); expect(e.decisao.modo).toBe('nenhuma') }
  })
  it('se a antiga também já falhou → falhar', () => {
    expect(erro('rede', undefined, true).decisao.acao).toBe('falhar')
  })
  it('erro devolvido pela API dentro do JSON → fallback', () => {
    const e = prepararExtracaoRubricas({ tipo: 'api', data: { error: { type: 'overloaded_error', message: 'Overloaded' } } }, opc)
    expect(e.decisao.acao).toBe('usar_legado')
  })
  it('antiga já falhou mas há linhas parciais → conserva-as como INCOMPLETAS (nunca como completas)', () => {
    const t = textoResposta([montarFicheDetalhada(PERFIL_A)])
    const e = prepararExtracaoRubricas({ tipo: 'texto', texto: t.slice(0, t.indexOf('"libelle":"Heures supplémentaires 50%"') + 12), stopReason: 'max_tokens' }, { ...opc, legadoJaTentado: true })
    expect(e.decisao.acao).toBe('usar_detalhada')
    expect(e.decisao.modo).toBe('detalhada_incompleta')
    expect(rotuloModoExtracao(e.decisao.modo).includes('INCOMPLETA')).toBe(true)
    expect(e.decisao.modo === 'detalhada_estrutura_verificada').toBe(false)
  })
  it('INVARIANTE: usar_legado ⇒ modo legado e rótulo sem «detalhada»; garantia sempre false', () => {
    const t = textoResposta([montarFicheDetalhada(PERFIL_C)])
    const casos: ExtracaoPreparada[] = [
      erro('rede'), erro('timeout'), erro('http', 500), erro('http', 401), erro('rede', undefined, true),
      prepararExtracaoRubricas(api(PERFIL_A), opc), prepararExtracaoRubricas(api(PERFIL_A, { omitirFin: true }), opc),
      prepararExtracaoRubricas({ tipo: 'texto', texto: t.slice(0, 500), stopReason: 'max_tokens' }, opc),
      prepararExtracaoRubricas({ tipo: 'texto', texto: null }, opc),
    ]
    for (const e of casos) {
      expect(e.decisao.garantiaLeituraCompleta).toBe(false)
      if (e.decisao.acao === 'usar_legado') {
        expect(e.decisao.modo).toBe('legado')
        expect(rotuloModoExtracao(e.decisao.modo).toLowerCase().includes('detalhada')).toBe(false)
      }
    }
  })
})

describe('7. campos legados preservados', () => {
  it('camposLegados = resposta sem as 5 chaves detalhadas; mesmas chaves do exemplo legado', () => {
    for (const p of PERFIS) {
      const e = prepararExtracaoRubricas(api(p), opc)
      expect(e.camposLegados.length).toBe(1)
      expect(e.camposLegados[0]).toEqual(p.legado)
      expect(Object.keys(e.camposLegados[0]).sort()).toEqual(chavesLegadasDoPrompt().sort())
      for (const k of ['lignes', 'totaux', 'nbLignes', 'fin', 'versionPrompt']) expect(k in e.camposLegados[0]).toBe(false)
    }
  })
  it('os campos legados também ficam em desconhecidos do documento (nada se perde)', () => {
    const d = doc(prepararExtracaoRubricas(api(PERFIL_B), opc))
    expect(d.desconhecidos.netPaye).toBe(PERFIL_B.legado.netPaye)
    expect(d.desconhecidos.entreprise).toBe(PERFIL_B.legado.entreprise)
    expect(d.periodoDocumento.mes).toBe(5)
    expect(d.periodoDocumento.ano).toBe(2026)
  })
  it('a entrada (profundamente congelada) não é alterada e o resultado não partilha referências', () => {
    const data = deepFreeze(respostaAPI(textoResposta([montarFicheDetalhada(PERFIL_A)])))
    const antes = JSON.stringify(data)
    const e = prepararExtracaoRubricas({ tipo: 'api', data }, opc)
    expect(JSON.stringify(data)).toBe(antes)
    e.camposLegados[0].netPaye = 1
    expect(PERFIL_A.legado.netPaye).toBe(2310.45)
  })
  it('determinismo: mesma entrada ⇒ mesmos ids e mesmo resultado (com `agora` fixo)', () => {
    const a = prepararExtracaoRubricas(api(PERFIL_C), opc), b = prepararExtracaoRubricas(api(PERFIL_C), opc)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  it('camposLegadosDe não altera a entrada', () => {
    const o: Obj = deepFreeze({ tipo: 'fiche', lignes: [{ n: 1 }], fin: true, netPaye: 5 })
    expect(camposLegadosDe(o)).toEqual({ tipo: 'fiche', netPaye: 5 })
  })
})

describe('8. a aprendizagem salarial não é afetada', () => {
  // mesmo mapeamento que o fiche.tsx faz hoje (campos lidos do objeto extraído)
  const boletim = (pf: Obj): BoletimExtraido => ({
    periodo: String(pf.periode ?? ''), moisIndex: Number(pf.moisIndex ?? 0), annee: Number(pf.annee ?? 2026),
    netPaye: Number(pf.netPaye) || 0, salairebrut: Number(pf.salairebrut) || 0, hval: Number(pf.hval) || null,
    heuresSuppl25: Number(pf.heuresSuppl25) || null, heuresSuppl50: Number(pf.heuresSuppl50) || null, heuresNuit: Number(pf.heuresNuit) || null,
    joursCongesN: Number(pf.joursCongesN) || null, joursCongesN1: Number(pf.joursCongesN1) || null, joursRC: Number(pf.joursRC) || null,
    fraisBoletim: Number(pf.remboursementFrais) || null,
    rubriquesDesconhecidas: (pf.rubriquesDesconhecidas as { nome: string; valor: number }[]) || [],
    dataPagamento: null, mesTrabalho: null,
  })
  it('o padrão aprendido é idêntico com a resposta antiga, a nova inteira, ou só os camposLegados', () => {
    for (const p of PERFIS) {
      const completa = montarFicheDetalhada(p)
      const e = prepararExtracaoRubricas(api(p), opc)
      const a = actualizarPadraoComBoletim(boletim(p.legado), PADRAO_INICIAL)
      const b = actualizarPadraoComBoletim(boletim(completa), PADRAO_INICIAL)
      const c = actualizarPadraoComBoletim(boletim(e.camposLegados[0]), PADRAO_INICIAL)
      expect(JSON.stringify(b)).toBe(JSON.stringify(a))
      expect(JSON.stringify(c)).toBe(JSON.stringify(a))
    }
  })
  it('as linhas NÃO alimentam os campos fantasma (heuresSuppl25/50, heuresNuit, joursCongesN/N1, rubriquesDesconhecidas)', () => {
    for (const p of PERFIS) {
      const k = Object.keys(prepararExtracaoRubricas(api(p), opc).camposLegados[0])
      for (const f of ['heuresSuppl25', 'heuresSuppl50', 'heuresNuit', 'joursCongesN', 'joursCongesN1', 'rubriquesDesconhecidas']) expect(k.includes(f)).toBe(false)
    }
  })
  it('o ficheiro engine/aprendizagem.ts não referencia os módulos novos', () => {
    const src = ler('src/engine/aprendizagem.ts')
    expect(/rubricas|promptRubricas|completudeRubricas|extracaoRubricas/i.test(src)).toBe(false)
  })
})

describe('9. isolamento (etapa 2D): só o backup/restauro usa o armazém; a extração continua fora do fluxo real', () => {
  const listar = (dir: string, out: string[] = []): string[] => {
    for (const nome of fs.readdirSync(path.join(RAIZ, dir))) {
      if (nome === 'node_modules' || nome.startsWith('.')) continue
      const rel = `${dir}/${nome}`
      if (fs.statSync(path.join(RAIZ, rel)).isDirectory()) listar(rel, out)
      else if (/\.(ts|tsx)$/.test(nome)) out.push(rel)
    }
    return out
  }
  const NOVOS = /(^|\/)(promptRubricas|promptRubricasLegado|completudeRubricas|extracaoRubricas|rubricasFixtures|rubricasNumeros|rubricas|rubricasStore|escritaComRollback|backupRubricas|importacaoRubricas|identidadeFicheiro|autotesteRubricas)(\.test)?\.ts$/
  const ficheiros = [...listar('app'), ...listar('src')].filter(f => !NOVOS.test(f))
  it('nenhum ficheiro da app importa os módulos de extração/prompt/completude (continuam fora do fluxo)', () => {
    for (const f of ficheiros) {
      const src = ler(f)
      if (/(promptRubricas|completudeRubricas|extracaoRubricas|rubricasFixtures|utils\/rubricas|types\/rubricas|\.\/rubricas)['"]/.test(src)) throw new Error(`${f} importa módulos de rubricas`)
    }
    expect(ficheiros.length).toBeGreaterThan(20)
  })
  it('só reglages.tsx importa rubricasStore e escritaComRollback; fiche.tsx e o resto da app não', () => {
    const quem = ficheiros.filter(f => /(rubricasStore|escritaComRollback)['"]/.test(ler(f)))
    expect(quem).toEqual(['app/(tabs)/reglages.tsx'])
  })
  it('só reglages.tsx referencia a chave monSalaire_rubricas_v1 diretamente ou via CHAVE_RUBRICAS; nenhum outro ficheiro a toca', () => {
    for (const f of ficheiros) {
      if (f === 'app/(tabs)/reglages.tsx') continue
      const src = ler(f)
      if (src.includes('monSalaire_rubricas_v1') || /CHAVE_RUBRICAS/.test(src)) throw new Error(`${f} referencia a chave das rubricas`)
    }
    expect(true).toBe(true)
  })
  it('o motor, a aprendizagem e o histórico não conhecem o armazém de rubricas', () => {
    for (const f of ['src/engine/aprendizagem.ts', 'src/utils/filaHistorico.ts']) {
      expect(/rubricas|escritaComRollback/i.test(ler(f))).toBe(false)
    }
  })
  it('fiche.tsx continua com o prompt legado, sem «lignes»/«nbLignes» e sem rub-2', () => {
    const fiche = ler('app/(tabs)/fiche.tsx')
    expect(fiche.includes(PROMPT_FICHES_LEGADO)).toBe(true)
    expect(fiche.includes('nbLignes')).toBe(false)
    expect(fiche.includes('rub-2')).toBe(false)
    expect(fiche.includes('"lignes"')).toBe(false)
  })
  it('reglages.tsx: rubricas entram no backup, ficam fora da importação direta e usam fila + rollback partilhados', () => {
    const r = ler('app/(tabs)/reglages.tsx')
    expect(r.includes('CHAVE_RUBRICAS')).toBe(true)
    expect(/IMPORT_DIRETO_KEYS[^\n]*CHAVE_RUBRICAS/.test(r)).toBe(true)
    expect(r.includes('prepararRestauroRubricas')).toBe(true)
    expect(r.includes('escreverComRollback(AsyncStorage')).toBe(true)
    expect(r.includes('comFilaHistorico(() => comFilaRubricas')).toBe(true)
  })
  it('o proxy e o validarPedido não mudaram de limites (continuam 4000 tokens / 8000 / 500)', () => {
    expect(ler('netlify/functions/anthropic-proxy.js').includes('body.max_tokens > 4000')).toBe(true)
    const v = ler('netlify/lib/validarPedido.js')
    expect(v.includes('MAX_TEXTO = 8000')).toBe(true)
    expect(v.includes('MAX_SYSTEM = 500')).toBe(true)
  })
})

describe('10. identidade estável do ficheiro (Etapa 2E): opção hashDocumento', () => {
  const resp = () => ({ tipo: 'api' as const, data: respostaAPI(textoResposta([montarFicheDetalhada(PERFIL_A)])) })
  it('com hashDocumento, o documento fica com esse hash e um id derivado dele (não do conteúdo)', () => {
    const a = prepararExtracaoRubricas(resp(), { agora: '2026-10-14T10:00:00.000Z', hashDocumento: 'fx1:10:abc:def' })
    expect(a.documentos[0].hashDocumento).toBe('fx1:10:abc:def')
    expect(a.documentos[0].origemId).toBe('hash_documento')
  })
  it('o hash do ficheiro PREVALECE sobre um «hash» que a IA invente na resposta', () => {
    const t = { tipo: 'api' as const, data: respostaAPI(textoResposta([{ ...montarFicheDetalhada(PERFIL_A), hash: 'inventado' }])) }
    const a = prepararExtracaoRubricas(t, { agora: '2026-10-14T10:00:00.000Z', hashDocumento: 'fx1:10:abc:def' })
    expect(a.documentos[0].hashDocumento).toBe('fx1:10:abc:def')
  })
  it('sem hashDocumento o comportamento é o de sempre (id pelo conteúdo)', () => {
    const a = prepararExtracaoRubricas(resp(), { agora: '2026-10-14T10:00:00.000Z' })
    expect(a.documentos[0].origemId).toBe('conteudo'); expect(a.documentos[0].hashDocumento).toBeNull()
    const b = prepararExtracaoRubricas(resp(), { agora: '2026-10-14T10:00:00.000Z', hashDocumento: '' })
    expect(b.documentos[0].origemId).toBe('conteudo')
  })
  it('mesmo hash e mesmas linhas ⇒ mesmo id; hash diferente ⇒ id diferente', () => {
    const o = { agora: '2026-10-14T10:00:00.000Z' }
    const x = prepararExtracaoRubricas(resp(), { ...o, hashDocumento: 'h1' }).documentos[0]
    const y = prepararExtracaoRubricas(resp(), { ...o, hashDocumento: 'h1' }).documentos[0]
    const z = prepararExtracaoRubricas(resp(), { ...o, hashDocumento: 'h2' }).documentos[0]
    expect(x.idDocumento).toBe(y.idDocumento); expect(x.idDocumento === z.idDocumento).toBe(false)
  })
})
