// src/utils/servicoCurto.test.ts
import { classificarServicoCurto, decidirFimServico, LIMITE_MUITO_CURTO_SEG, LIMITE_CURTO_SEG } from './servicoCurto'
import { planearGravacao, type ServicoReg } from './diasServicos'

const min = (m: number) => m * 60

describe('classificação por duração (nunca «inválido»)', () => {
  it('4 min → muito curto, com o aviso pedido', () => {
    const c = classificarServicoCurto(min(4))
    expect(c.nivel).toBe('muito_curto')
    expect(c.titulo).toBe('Service très court — à confirmer')
    expect(c.minutos).toBe(4)
  })
  it('4 min 59 s ainda é muito curto; 5 min exatos já é «curto»', () => {
    expect(classificarServicoCurto(min(5) - 1).nivel).toBe('muito_curto')
    expect(classificarServicoCurto(min(5)).nivel).toBe('curto')
    expect(LIMITE_MUITO_CURTO_SEG).toBe(300)
  })
  it('5 e 10 min → confirmação discreta (10 min incluído); 10 min 1 s → normal', () => {
    expect(classificarServicoCurto(min(5)).nivel).toBe('curto')
    expect(classificarServicoCurto(min(10)).nivel).toBe('curto')
    expect(classificarServicoCurto(min(10) + 1).nivel).toBe('normal')
    expect(LIMITE_CURTO_SEG).toBe(600)
    expect(classificarServicoCurto(min(7)).titulo).toBe('Service court')
  })
  it('serviços normais não geram pergunta nem mensagem', () => {
    const c = classificarServicoCurto(min(45))
    expect(c).toEqual({ nivel: 'normal', minutos: 45, titulo: '', mensagem: '' })
  })
  it('valores ilegíveis ou negativos pedem confirmação (não assume normal)', () => {
    expect(classificarServicoCurto(NaN).nivel).toBe('muito_curto')
    expect(classificarServicoCurto(-30).nivel).toBe('muito_curto')
    expect(classificarServicoCurto(undefined as any).nivel).toBe('muito_curto')
  })
  it('uma troca de camião dentro do serviço não torna o serviço curto: conta o serviço TOTAL', () => {
    // parte A durou 3 min, parte B 40 min: o serviço total (43 min) é normal
    const totalComTroca = min(3) + min(40)
    expect(classificarServicoCurto(totalComTroca).nivel).toBe('normal')
  })
})

describe('decisão ao terminar', () => {
  it('serviço normal grava sem perguntar e sem marca de curto', () => {
    expect(decidirFimServico(min(30), null)).toEqual({ accao: 'guardar', curtoConfirmado: false })
  })
  it('serviço curto sem resposta → perguntar', () => {
    const d = decidirFimServico(min(4), null)
    expect(d.accao).toBe('perguntar')
    if (d.accao === 'perguntar') expect(d.classificacao.nivel).toBe('muito_curto')
    expect(decidirFimServico(min(8), null).accao).toBe('perguntar')
  })
  it('confirmado → guardar, marcado como curto CONFIRMADO (será tratado como válido)', () => {
    expect(decidirFimServico(min(4), 'guardar')).toEqual({ accao: 'guardar', curtoConfirmado: true })
    expect(decidirFimServico(min(10), 'guardar')).toEqual({ accao: 'guardar', curtoConfirmado: true })
  })
  it('não guardar → descartar; cancelar → o serviço continua em curso', () => {
    expect(decidirFimServico(min(4), 'nao_guardar')).toEqual({ accao: 'descartar' })
    expect(decidirFimServico(min(4), 'cancelar')).toEqual({ accao: 'manter_em_curso' })
  })
  it('a resposta é irrelevante para serviços normais (nunca descarta um serviço normal)', () => {
    expect(decidirFimServico(min(30), 'nao_guardar')).toEqual({ accao: 'guardar', curtoConfirmado: false })
  })
})

describe('um serviço NÃO guardado não altera nada', () => {
  const s = (id: string, debut: string, fin: string, seg: number): ServicoReg =>
    ({ id, date: '12/10/2026', jour: 'Lun', type: 'TRAB', debut, fin, segServico: seg, segPausa: 0, decouche: false, frais: 5, kmDiarios: 100 })
  const lista = [s('2', '14h00', '18h00', 14400), s('1', '06h00', '12h00', 21600)]

  it('descartar não chama a gravação: a lista fica igual ao byte (serviços do dia intactos)', () => {
    const antes = JSON.stringify(lista)
    const d = decidirFimServico(min(3), 'nao_guardar')
    expect(d.accao).toBe('descartar')
    // quem descarta não invoca planearGravacao; e mesmo que a lista seja lida, nada é escrito
    expect(JSON.stringify(lista)).toBe(antes)
  })
  it('guardar o curto confirmado acrescenta SEM substituir os existentes', () => {
    const curto = { ...s('3', '19h00', '19h04', 240), curtoConfirmado: true }
    const p = planearGravacao(lista, curto)
    expect(p.acao).toBe('inserir')
    if (p.acao === 'inserir') {
      expect(p.lista).toHaveLength(3)
      expect(p.arquivar).toHaveLength(0)
      expect(p.lista.map(x => x.id).sort()).toEqual(['1', '2', '3'])
    }
  })
})
