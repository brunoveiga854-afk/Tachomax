// src/engine/regras/lerContexto.test.ts
import * as fs from 'fs'
import * as path from 'path'
import { lerContextoAssistente, prepararRespostas, AVISO_NAO_AUTORIZACAO, CHAVES_LIDAS, type LeitorStorage, type ContextoAssistente } from './lerContexto'

const L = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m - 1, d, h, mi).getTime()
const W = (y: number, m: number, d: number, h: number, mi: number) => Date.UTC(y, m - 1, d, h, mi) // hora de parede do motor

/** Leitor falso: só tem multiGet; regista TUDO o que a lógica tenta usar (Proxy). */
function fake(dados: Record<string, string | undefined>) {
  const acessos: string[] = []
  const alvo = { multiGet: async (keys: readonly string[]) => keys.map(k => [k, dados[k] ?? null] as const) }
  const proxy = new Proxy(alvo, { get(t, p) { acessos.push(String(p)); return (t as any)[p] } })
  return { storage: proxy as unknown as LeitorStorage, acessos }
}

const servicoAnterior = (fin = '16h00', segServico = 34000) => ({
  id: String(L(2026, 10, 12, 16, 0)), date: '12/10', jour: 'Lun', type: 'TRAB', debut: '06h00', fin, segServico, segPausa: 2000, decouche: false, frais: 0,
})
const T0 = L(2026, 10, 13, 6, 30)
const estadoCorrer = (o: Record<string, unknown> = {}, ini = T0) => JSON.stringify({
  enService: true, emPausa: false, decouche: false, dateInicio: new Date(ini).toISOString(), horaInicio: '06h30',
  segServicoBase: 0, tsInicioServico: ini, segPausaTotal: 0, ...o,
})
const dados = (estado: string | undefined, historico: unknown[] | string | undefined, extra: Record<string, string | undefined> = {}) => ({
  TACHOOFFICE_estado: estado,
  historique: typeof historico === 'string' ? historico : historico === undefined ? undefined : JSON.stringify(historico),
  profil: 'MIXTE',
  ...extra,
})
const agora2h = T0 + 2 * 3600_000

const lerCom = (d: Record<string, string | undefined>, agora = agora2h) => lerContextoAssistente(fake(d).storage, agora)
const resp = (c: ContextoAssistente, id: 'amplitude' | 'servico' | 'repos') => prepararRespostas(c).respostas.find(r => r.id === id)!

describe('sem serviço / dados ilegíveis', () => {
  it('sem snapshot: nada é calculado e as 3 perguntas pedem o serviço em curso', async () => {
    const c = await lerCom(dados(undefined, [servicoAnterior()]))
    expect(c.situacao).toBe('sem_servico')
    expect(c.motor).toBeNull()
    expect(c.estado).toBe('dados_insuficientes')
    const { respostas, situacao } = prepararRespostas(c)
    expect(situacao.texto).toContain('Aucun service en cours')
    for (const r of respostas) {
      expect(r.disponivel).toBe(false)
      expect(r.linhas).toHaveLength(0)
      expect(r.informationManquante[0]).toContain('Service en cours')
    }
  })
  it('JSON do snapshot inválido: situação inválida, sem exceção', async () => {
    const c = await lerCom(dados('{mau', [servicoAnterior()]))
    expect(c.situacao).toBe('invalido')
    expect(c.motor).toBeNull()
    expect(resp(c, 'amplitude').disponivel).toBe(false)
  })
  it('snapshot antigo (sem dateInicio nem âncoras): inválido, tempo não reconstruído', async () => {
    const c = await lerCom(dados(JSON.stringify({ enService: true, horaInicio: '06h30', segServico: 100 }), [servicoAnterior()]))
    expect(c.situacao).toBe('invalido')
    expect(c.motivo).toContain('formato antigo')
  })
  it('falha na leitura do armazenamento: erro_leitura, sem exceção', async () => {
    const storage: LeitorStorage = { multiGet: async () => { throw new Error('x') } }
    const c = await lerContextoAssistente(storage, agora2h)
    expect(c.situacao).toBe('erro_leitura')
    expect(c.estado).toBe('dados_insuficientes')
  })
  it('histórico ilegível: avisa, não corrige, e sem descanso anterior não há amplitude', async () => {
    const c = await lerCom(dados(estadoCorrer(), '{mau'))
    expect(c.historicoLegivel).toBe(false)
    expect(c.avisos.some(a => a.includes('ilegível'))).toBe(true)
    expect(resp(c, 'amplitude').disponivel).toBe(false)
  })
})

describe('serviço em curso com histórico', () => {
  it('amplitude, serviço e repos calculados como SIMULAÇÃO condicionada — nunca autorização', async () => {
    const c = await lerCom(dados(estadoCorrer({ segServicoBase: 0 }), [servicoAnterior()]))
    expect(c.situacao).toBe('em_curso')
    expect(c.estado).toBe('simulacao_condicionada')
    expect(c.motor!.autorizacao).toBe('nao_concedida')
    const amp = c.motor!.restricoes.find(r => r.id === 'amplitude_janela_descanso')!
    expect(amp.fimMaximoMs).toBe(W(2026, 10, 13, 19, 30)) // início 06h30 + 24h − 11h
    // serviço: 12 h − 2 h feitas = 10 h; fim às 08h30 + 10 h = 18h30
    const srv = c.motor!.restricoes.find(r => r.id === 'servico_diario')!
    expect(srv.fimMaximoMs).toBe(W(2026, 10, 13, 18, 30))
    const a = resp(c, 'amplitude')
    expect(a.disponivel).toBe(true)
    expect(a.linhas[0].valor).toBe('13/10 19h30')
    expect(a.linhas[1].valor).toBe('11 h 00 min')
    const s = resp(c, 'servico')
    expect(s.disponivel).toBe(true)
    expect(s.linhas.find(l => l.rotulo === 'Service restant (limite journalière, calcul)')!.valor).toBe('10 h 00 min')
    const r = resp(c, 'repos')
    expect(r.disponivel).toBe(true)
    expect(r.linhas[0].rotulo).toBe('Repos quotidien normal : 11 h')
    expect(r.linhas[0].valor).toContain('13/10 19h30')
  })
  it('o que a app não sabe aparece como «Information manquante / à confirmer», nada é deduzido do perfil', async () => {
    const c = await lerCom(dados(estadoCorrer(), [servicoAnterior()], { profil: 'LD' }))
    const ent = c.adaptador!.entrada
    expect(ent.contexto.categoria).toBe('desconhecida')
    expect(c.adaptador!.diagnostico.perfilApp).toBe('LD')
    const a = resp(c, 'amplitude')
    expect(a.aConfirmer.some(t => t.includes('561/2006'))).toBe(true)
    expect(a.aConfirmer.some(t => t.includes('fin du repos précédent'))).toBe(true)
    const s = resp(c, 'servico')
    expect(s.aConfirmer.some(t => t.includes('Catégorie réglementaire'))).toBe(true)
    expect(s.naoVerificadas.some(t => t.includes('hebdomadaire'))).toBe(true)
  })
  it('sem frases de autorização e com o aviso de não-autorização em todas as respostas', async () => {
    const c = await lerCom(dados(estadoCorrer(), [servicoAnterior()]))
    const { respostas, situacao } = prepararRespostas(c)
    const texto = JSON.stringify([respostas, situacao])
    expect(/peux continuer|pouvez continuer|vous pouvez|tu peux|autorisé à|autorisation accordée/i.test(texto)).toBe(false)
    for (const r of respostas) expect(r.aviso).toBe(AVISO_NAO_AUTORIZACAO)
    expect(c.estado).not.toBe('confirmado')
  })
  it('limites de condução nunca são calculados: ficam declarados como não avaliados', async () => {
    const c = await lerCom(dados(estadoCorrer(), [servicoAnterior()]))
    const r = resp(c, 'servico')
    expect(r.naoVerificadas.some(t => t.includes('conduite') && t.includes('non évaluées'))).toBe(true)
    expect(JSON.stringify(r.linhas)).not.toContain('conduite')
  })
  it('sem histórico: sem descanso anterior → dados insuficientes e sem valores', async () => {
    const c = await lerCom(dados(estadoCorrer(), []))
    expect(c.estado).toBe('dados_insuficientes')
    for (const id of ['amplitude', 'servico', 'repos'] as const) {
      const r = resp(c, id)
      expect(r.disponivel).toBe(false)
      expect(r.linhas).toHaveLength(0)
    }
    expect(resp(c, 'amplitude').informationManquante.some(t => t.includes('Fin du repos précédent'))).toBe(true)
  })
})

describe('pausa iniciada e pausa terminada', () => {
  it('pausa iniciada: serviço congelado, pausa aberta registada, resposta calculada', async () => {
    const P = T0 + 3600_000
    const st = estadoCorrer({ emPausa: true, tsInicioServico: null, segServicoBase: 3600, segServico: 3600, tsPauseInicio: P, segPausa: 0, segPausaTotal: 0 })
    const c = await lerCom(dados(st, [servicoAnterior()]), P + 900_000)
    expect(c.situacao).toBe('em_curso')
    expect(c.emPausa).toBe(true)
    expect(c.adaptador!.entrada.servicoAcumuladoSeg).toBe(3600)
    expect(c.adaptador!.entrada.pausas).toHaveLength(1)
    expect(c.adaptador!.entrada.pausas![0].natureza).toBeUndefined() // nunca assume pausa regulamentar
    expect(prepararRespostas(c).situacao.texto).toContain('pause en cours')
  })
  it('pausa terminada: serviço volta a contar; pausa existir não a torna regulamentar', async () => {
    const st = estadoCorrer({ segServicoBase: 3000, tsInicioServico: T0 + 4200_000, segPausaTotal: 1200, pausasDia: [{ inicio: T0 + 3000_000, dur: 1200 }] })
    const c = await lerCom(dados(st, [servicoAnterior()]), T0 + 4200_000 + 600_000)
    expect(c.emPausa).toBe(false)
    expect(c.adaptador!.entrada.servicoAcumuladoSeg).toBe(3600)
    expect(c.adaptador!.entrada.pausas).toHaveLength(1)
    const s = resp(c, 'servico')
    expect(s.aConfirmer.some(t => t.includes('Nature des pauses'))).toBe(true)
    expect(c.motor!.pausas!.validasSeg).toBe(0) // 20 min registados, 0 verificados
  })
  it('segPausa sem detalhe horário: não é posicionada e fica declarada em falta', async () => {
    const st = estadoCorrer({ segServicoBase: 3600, tsInicioServico: T0 + 3600_000, segPausaTotal: 1800 })
    const c = await lerCom(dados(st, [servicoAnterior()]), T0 + 3600_000)
    expect(c.adaptador!.entrada.pausas).toHaveLength(0)
    expect(resp(c, 'servico').aConfirmer.some(t => t.includes('sans détail horaire'))).toBe(true)
  })
})

describe('serviço a atravessar a meia-noite', () => {
  it('iniciado às 22h00 e consultado às 02h00: janela a partir do início, limite noturno de 10 h', async () => {
    const ini = L(2026, 10, 12, 22, 0)
    const agora = L(2026, 10, 13, 2, 0)
    const anterior = { ...servicoAnterior('16h00'), id: String(L(2026, 10, 11, 16, 0)), date: '11/10', jour: 'Dim' }
    const st = JSON.stringify({ enService: true, emPausa: false, dateInicio: new Date(ini).toISOString(), horaInicio: '22h00', segServicoBase: 0, tsInicioServico: ini, segPausaTotal: 0 })
    const c = await lerCom(dados(st, [anterior]), agora)
    expect(c.situacao).toBe('em_curso')
    expect(c.adaptador!.entrada.inicioServicoMs).toBe(W(2026, 10, 12, 22, 0))
    expect(c.adaptador!.entrada.referenciaMs).toBe(W(2026, 10, 13, 2, 0))
    const amp = c.motor!.restricoes.find(r => r.id === 'amplitude_janela_descanso')!
    expect(amp.fimMaximoMs).toBe(W(2026, 10, 13, 11, 0))
    const srv = c.motor!.restricoes.find(r => r.id === 'servico_diario')!
    expect(srv.detalhe!.trabalhoNoturno).toBe(true)
    expect(srv.fimMaximoMs).toBe(W(2026, 10, 13, 8, 0)) // 4 h feitas, limite 10 h → +6 h
    expect(resp(c, 'servico').linhas.some(l => l.rotulo.includes('travail de nuit'))).toBe(true)
    expect(resp(c, 'amplitude').linhas[1].valor).toBe('9 h 00 min')
  })
  it('iniciado a 31/12 e consultado a 01/01: o ano de início é respeitado', async () => {
    const ini = L(2026, 12, 31, 22, 0)
    const agora = L(2027, 1, 1, 1, 0)
    const anterior = { ...servicoAnterior('16h00'), id: String(L(2026, 12, 30, 16, 0)), date: '30/12' }
    const st = JSON.stringify({ enService: true, dateInicio: new Date(ini).toISOString(), segServicoBase: 0, tsInicioServico: ini })
    const c = await lerCom(dados(st, [anterior]), agora)
    expect(c.situacao).toBe('em_curso')
    expect(c.adaptador!.entrada.inicioServicoMs).toBe(W(2026, 12, 31, 22, 0))
    expect(resp(c, 'amplitude').disponivel).toBe(true)
  })
})

describe('transição serviço em curso → terminado', () => {
  it('snapshot ainda presente mas o serviço já está no histórico: não conta duas vezes', async () => {
    const guardado = { id: String(agora2h), date: '13/10', jour: 'Mar', type: 'TRAB', debut: '06h30', fin: '08h30', segServico: 7200, segPausa: 0 }
    const c = await lerCom(dados(estadoCorrer(), [guardado, servicoAnterior()]))
    expect(c.situacao).toBe('transicao')
    expect(c.motor).toBeNull()
    expect(prepararRespostas(c).situacao.texto).toContain("vient d'être enregistré")
  })
  it('depois de o snapshot desaparecer: sem serviço em curso', async () => {
    const guardado = { id: String(agora2h), date: '13/10', jour: 'Mar', type: 'TRAB', debut: '06h30', fin: '08h30', segServico: 7200, segPausa: 0 }
    const c = await lerCom(dados(undefined, [guardado, servicoAnterior()]))
    expect(c.situacao).toBe('sem_servico')
  })
  it('o próprio serviço nunca é usado como «serviço anterior» de si próprio', async () => {
    const c = await lerCom(dados(estadoCorrer(), [servicoAnterior()]))
    expect(c.adaptador!.diagnostico.servicoAnteriorEncontrado).toBe(true)
    expect(c.adaptador!.diagnostico.gapDescansoAnteriorSeg).toBe(14.5 * 3600)
  })
})

describe('correções no histórico refletem-se na consulta seguinte (sem cache)', () => {
  it('fim corrigido para 23h00 (intervalo <9 h) → sem amplitude; corrigido de volta → volta; serviço apagado → sem amplitude', async () => {
    const st = estadoCorrer()
    const a = await lerCom(dados(st, [servicoAnterior('16h00')]))
    expect(resp(a, 'amplitude').disponivel).toBe(true)
    const b = await lerCom(dados(st, [servicoAnterior('23h00')]))
    expect(resp(b, 'amplitude').disponivel).toBe(false)
    expect(b.adaptador!.diagnostico.gapDescansoAnteriorSeg).toBe(7.5 * 3600)
    const c = await lerCom(dados(st, [servicoAnterior('16h00')]))
    expect(resp(c, 'amplitude').disponivel).toBe(true)
    const d = await lerCom(dados(st, []))
    expect(resp(d, 'amplitude').disponivel).toBe(false)
  })
  it('a leitura é feita no momento da chamada: mudar o armazenamento entre chamadas muda o resultado', async () => {
    const d = dados(estadoCorrer(), [servicoAnterior('16h00')])
    const f = fake(d)
    const c1 = await lerContextoAssistente(f.storage, agora2h)
    d.historique = JSON.stringify([])
    const c2 = await lerContextoAssistente(f.storage, agora2h)
    expect(c1.estado).toBe('simulacao_condicionada')
    expect(c2.estado).toBe('dados_insuficientes')
  })
})

describe('somente leitura', () => {
  it('só usa multiGet, só sobre as chaves da app, e não altera os dados lidos', async () => {
    const d = dados(estadoCorrer(), [servicoAnterior()], { pausaFimTimestamp: String(agora2h + 1000) })
    const antes = JSON.stringify(d)
    const f = fake(d)
    await lerContextoAssistente(f.storage, agora2h)
    expect(Array.from(new Set(f.acessos))).toEqual(['multiGet'])
    expect(JSON.stringify(d)).toBe(antes)
    expect(CHAVES_LIDAS.slice().sort()).toEqual(['TACHOOFFICE_estado', 'historique', 'pausaFimTimestamp', 'profil'])
  })
  it('o código-fonte novo não usa nenhuma API de escrita do AsyncStorage', () => {
    const proibido = /\b(setItem|removeItem|multiSet|multiRemove|mergeItem|multiMerge|clear)\s*\(/
    const ficheiros = [
      path.join(__dirname, 'emCurso.ts'),
      path.join(__dirname, 'lerContexto.ts'),
      path.join(__dirname, '../../../app/assistente.tsx'),
    ]
    let lidos = 0
    for (const f of ficheiros) {
      if (!fs.existsSync(f)) continue
      lidos++
      expect(proibido.test(fs.readFileSync(f, 'utf8'))).toBe(false)
    }
    expect(lidos).toBeGreaterThan(1)
  })
})
