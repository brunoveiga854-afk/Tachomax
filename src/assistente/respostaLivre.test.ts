// src/assistente/respostaLivre.test.ts — ligação do interpretador ao motor EXISTENTE (sem recalcular nada).
import { lerContextoAssistente, prepararRespostas, type LeitorStorage, type ContextoAssistente } from '../engine/regras/lerContexto'
import { simular } from '../engine/regras/simulacao'
import { interpretar, interpretacaoDireta, type IntencaoId } from './interpretador'
import { responder, responderIntencao, previewRapido, PERGUNTAS_RAPIDAS, type RespostaLivre } from './respostaLivre'

const L = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m - 1, d, h, mi).getTime()
const leitor = (dados: Record<string, string | undefined>) =>
  ({ multiGet: async (keys: readonly string[]) => keys.map(k => [k, dados[k] ?? null] as const) }) as unknown as LeitorStorage
const T0 = L(2026, 10, 13, 6, 30)
const anterior = { id: String(L(2026, 10, 12, 16, 0)), date: '12/10', jour: 'Lun', type: 'TRAB', debut: '06h00', fin: '16h00', segServico: 34000, segPausa: 2000, decouche: false, frais: 0 }
const estado = JSON.stringify({ enService: true, emPausa: false, decouche: false, dateInicio: new Date(T0).toISOString(), horaInicio: '06h30', segServicoBase: 0, tsInicioServico: T0, segPausaTotal: 0 })
const base = async (): Promise<ContextoAssistente> =>
  lerContextoAssistente(leitor({ TACHOOFFICE_estado: estado, historique: JSON.stringify([anterior]), profil: 'MIXTE' }), T0 + 2 * 3600_000)
const semServico = async () => lerContextoAssistente(leitor({ historique: JSON.stringify([anterior]), profil: 'MIXTE' }), T0)

const ask = (t: string, c: ContextoAssistente | null): RespostaLivre => responder(interpretar(t), c)
const TODAS: IntencaoId[] = ['amplitude', 'servico', 'repouso', 'pausas', 'pausa_limite', 'simulacao_fim', 'regras', 'sancoes', 'conducao', 'repouso_semanal']
const textoTodo = (r: RespostaLivre) => JSON.stringify(r)

describe('perguntas rápidas = mesmos resultados do motor', () => {
  it('amplitude / serviço / repouso reutilizam prepararRespostas (mesmo destaque e linhas)', async () => {
    const c = await base()
    const prep = prepararRespostas(c).respostas
    for (const [intencao, id] of [['amplitude', 'amplitude'], ['servico', 'servico'], ['repouso', 'repos']] as const) {
      const r = responderIntencao(interpretacaoDireta(intencao) as any, c)
      const esperado = prep.find(x => x.id === id)!
      expect(r.destaque).toEqual(esperado.destaque)
      expect(r.linhas).toEqual(esperado.linhas)
      expect(r.estado).toBe(esperado.estado)
    }
  })
  it('a pergunta escrita dá o mesmo que o cartão rápido', async () => {
    const c = await base()
    expect(ask('Quelle amplitude me reste-t-il ?', c)).toEqual(responderIntencao(interpretacaoDireta('amplitude') as any, c))
    expect(ask('Quanto tempo de serviço me resta?', c).destaque).toEqual(responderIntencao(interpretacaoDireta('servico') as any, c).destaque)
  })
  it('pré-visualização dos cartões: valor do motor ou «—», nunca inventado', async () => {
    const c = await base()
    for (const q of PERGUNTAS_RAPIDAS) expect(typeof previewRapido(q.intencao, c)).toBe('string')
    expect(previewRapido('amplitude', null)).toBe('…')
    const sem = await semServico()
    expect(previewRapido('amplitude', sem)).toBe('—')
    expect(previewRapido('pausas', sem)).toBe('—')
  })
})

describe('pausas', () => {
  it('usa o resultado de pausas já calculado pelo motor', async () => {
    const c = await base()
    const r = ask('Combien de pause dois-je faire ?', c)
    expect(r.intencao).toBe('pausas')
    if (c.motor?.pausas) {
      expect(r.tipo).toBe('resposta')
      expect(r.estado).toBe(c.motor.pausas.estado)
      expect(r.linhas.length).toBeGreaterThan(0)
    } else expect(r.tipo).toBe('nao_avaliado')
  })
  it('sem serviço em curso → não avaliado e a dizer o que falta', async () => {
    const r = ask('Combien de pause dois-je faire ?', await semServico())
    expect(r.tipo).toBe('nao_avaliado')
    expect(textoTodo(r)).toContain('Service en cours')
  })
})

describe('simulação com hora de fim', () => {
  it('liga a `simular` e usa a mesma comparação', async () => {
    const c = await base()
    const r = ask('Si je finis à 18h ?', c)
    const sim = simular(c, { pausaMin: 0, fimDesejado: { h: 18, m: 0 } })
    expect(sim.disponivel).toBe(true)
    if (!sim.disponivel || !sim.comparacao) return
    expect(r.tipo).toBe('simulacao')
    expect(r.destaque!.legenda).toBe(sim.comparacao.resumo)
    expect(r.estado).toBe(sim.motor.estado)
    expect(r.notas.join(' ')).toContain('Simulation')
  })
  it('hora + pausa chegam ao motor', async () => {
    const c = await base()
    const r = ask('Si je finis à 18h avec 30 min de pause ?', c)
    const sim = simular(c, { pausaMin: 30, fimDesejado: { h: 18, m: 0 } })
    if (sim.disponivel && sim.comparacao) expect(r.destaque!.legenda).toBe(sim.comparacao.resumo)
  })
  it('nunca diz «autorisé» nem apresenta o resultado como autorização', async () => {
    const r = ask('Posso trabalhar até às 20h?', await base())
    expect(textoTodo(r).toLowerCase()).not.toContain('autorisé')
    expect(r.aviso).toContain("Ce n'est pas une autorisation")
  })
  it('sem hora → incompleta, explica o que falta e não calcula', async () => {
    const r = ask('Si je finis bientôt ?', await base())
    expect(r.tipo).toBe('incompleta')
    expect(r.destaque).toBeNull()
    expect(r.notas.join(' ')).toContain("l'heure de fin")
  })
  it('hora ambígua → pede esclarecimento', async () => {
    const r = ask('et si 6h', await base())
    expect(r.tipo).toBe('incompleta')
    expect(r.notas.join(' ')).toContain('heure ou')
  })
  it('sem serviço → motivo do motor, nada inventado', async () => {
    const r = ask('Si je finis à 18h ?', await semServico())
    expect(r.tipo).toBe('nao_avaliado')
    expect(r.destaque).toBeNull()
    expect(r.notas.join(' ')).toContain('Aucun service')
  })
  it('pausa hipotética sem hora → simulação do serviço, marcada como hipótese', async () => {
    const c = await base()
    const r = ask('Combien de temps de service si je fais une pause de 45 minutes ?', c)
    expect(r.tipo).toBe('simulacao')
    expect(r.destaque!.legenda).toContain('45 min')
  })
})

describe('não suportado → «Non évalué», sem inventar', () => {
  it('condução: Non évalué + cronotacógrafo', async () => {
    for (const t of ['Quel est mon temps de conduite restant ?', 'Quanto tempo de condução me resta?']) {
      const r = ask(t, await base())
      expect(r.tipo).toBe('nao_avaliado')
      expect(r.destaque!.valor).toBe('Non évalué')
      expect(r.destaque!.legenda).toContain('pas mesuré séparément')
      expect(textoTodo(r)).toContain('chronotachygraphe')
    }
  })
  it('condução também responde sem serviço em curso (não depende do motor)', async () => {
    expect(ask('temps de conduite', await semServico()).destaque!.valor).toBe('Non évalué')
  })
  it('hora-limite de pausa: não apresenta nenhuma hora', async () => {
    for (const t of ["À quelle heure dois-je prendre ma pause ?", 'A que horas devo fazer a pausa?']) {
      const r = ask(t, await base())
      expect(r.tipo).toBe('nao_suportada')
      expect(r.destaque!.valor).toBe('Non calculée')
      expect(r.destaque!.legenda + r.destaque!.valor).not.toMatch(/\d{1,2}[h:]\d{2}/)
      expect(r.notas.join(' ')).toContain("ne calcule pas l'heure limite")
    }
  })
  it('repouso semanal: não suportado', async () => {
    const r = ask('Mon repos hebdomadaire', await base())
    expect(r.destaque!.valor).toBe('Non évalué')
  })
})

describe('regras e sanções', () => {
  it('regras: lista as existentes e remete para o acordeão', async () => {
    const r = ask('Quelles sont les règles ?', await base())
    expect(r.tipo).toBe('info')
    expect(r.linhas.length).toBeGreaterThan(0)
    expect(r.abrirRegras).toBe(true)
  })
  it('sanções: limitação clara, sem multas em euros, sem classes nem artigos de sanção', async () => {
    for (const c of [await base(), await semServico(), null]) {
      const r = ask('Quelles sanctions je risque ?', c)
      const t = textoTodo(r)
      expect(r.tipo).toBe('nao_suportada')
      expect(r.destaque!.valor).toBe('Non affichées')
      expect(t).not.toMatch(/€|euros?\b|\bEUR\b/i)
      expect(t).not.toMatch(/\b\d+\s?(e|€)\b/)
      expect(t).not.toMatch(/classe\s*[1-5]|4e classe|5e classe|R4[0-9]{3}|L3315|R3315/i)
      expect(t).toContain("n'est pas une infraction constatée")
      expect(r.abrirRegras).toBe(true)
    }
  })
  it('resultados calculados nunca são apresentados como infração', async () => {
    const t = textoTodo(ask('Si je finis à 23h ?', await base())).toLowerCase()
    expect(t).not.toContain('infraction')
    expect(t).not.toContain('amende')
  })
})

describe('ambiguidade e fora de âmbito', () => {
  it('ambígua → sugestões em vez de resposta', async () => {
    const r = ask('Combien de temps me reste-t-il ?', await base())
    expect(r.tipo).toBe('ambigua')
    expect(r.destaque).toBeNull()
    expect(r.sugestoes.length).toBeGreaterThan(1)
  })
  it('fora de âmbito → diz o que sabe fazer, sem calcular', async () => {
    const r = ask('Quelle est la météo demain ?', await base())
    expect(r.tipo).toBe('fora_ambito')
    expect(r.destaque).toBeNull()
    expect(r.notas.join(' ')).toContain('Je réponds seulement')
  })
  it('hora numa pergunta que não a usa: aviso explícito', async () => {
    const r = ask('Quelle amplitude me reste-t-il à 18h ?', await base())
    expect(r.intencao).toBe('amplitude')
    expect(r.notas.join(' ')).toContain("n'est pas utilisé")
  })
})

describe('segurança: perguntas livres não alteram nada', () => {
  it('o contexto não é mutado por nenhuma intenção', async () => {
    const c = await base()
    const antes = JSON.stringify(c)
    for (const i of TODAS) responderIntencao({ ...(interpretacaoDireta(i) as any), horaFim: { h: 18, m: 0 } }, c)
    for (const t of ['Si je finis à 18h ?', 'Quelles sanctions ?', 'conduite', 'pause', '', 'Si je finis à 18h avec 30 min de pause']) ask(t, c)
    expect(JSON.stringify(c)).toBe(antes)
  })
  it('contexto nulo (ainda a carregar) nunca rebenta', () => {
    for (const i of TODAS) expect(() => responderIntencao(interpretacaoDireta(i) as any, null)).not.toThrow()
    expect(ask('amplitude', null).tipo).toBe('a_carregar')
  })
  it('o módulo não importa armazenamento nem nada de escrita', () => {
    const fs = require('fs'), path = require('path')
    for (const f of ['respostaLivre.ts', 'interpretador.ts']) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
      expect(src).not.toMatch(/async-storage|AsyncStorage|setItem|multiSet|removeItem|fetch\(|XMLHttpRequest/)
    }
  })
  it('o interpretador não importa o motor', () => {
    const fs = require('fs'), path = require('path')
    const src = fs.readFileSync(path.join(__dirname, 'interpretador.ts'), 'utf8')
    expect(src).not.toMatch(/from '\.\.\/engine/)
  })
})
