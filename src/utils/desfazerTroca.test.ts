// src/utils/desfazerTroca.test.ts — cancelar serviço curto depois de troca de camião não deixa km gravados
import {
  adicionarKm, adicionarTracteur, diarioVazio, planearDesfazer, registarEfeitoKm, registarEfeitoTracteur,
  desfazerEfeitosDeTroca, lerDiario, CHAVE_DESFAZER, type ArmazenamentoDesfazer,
} from './desfazerTroca'
import { registarKm } from './camioes'

function armazem(inicial: Record<string, string> = {}) {
  const dados: Record<string, string> = { ...inicial }
  const s: ArmazenamentoDesfazer = {
    getItem: async k => (k in dados ? dados[k] : null),
    setItem: async (k, v) => { dados[k] = v },
    removeItem: async k => { delete dados[k] },
  }
  return { s, dados }
}
// simula o que a app faz (gravarKmCamiao) sobre o mesmo armazenamento
async function gravarKm(a: ReturnType<typeof armazem>, mat: string, km: number) {
  const antes = JSON.parse(a.dados.km_por_camiao ?? '{}')
  a.dados.km_por_camiao = JSON.stringify(registarKm(antes, mat, km))
}
const mapa = (a: ReturnType<typeof armazem>) => JSON.parse(a.dados.km_por_camiao ?? '{}')

describe('desfazerTroca — pura', () => {
  it('adicionarKm guarda o valor ANTES mais antigo e ignora km/matrícula inválidos', () => {
    let d = adicionarKm(diarioVazio(), { AB123CD: 1000 }, 'ab-123-cd', 1200)
    expect(d.km).toEqual([{ chave: 'AB123CD', antes: 1000, escrito: 1200 }])
    d = adicionarKm(d, { AB123CD: 1200 }, 'AB123CD', 1300)
    expect(d.km).toEqual([{ chave: 'AB123CD', antes: 1000, escrito: 1300 }])
    expect(adicionarKm(d, {}, '', 500)).toBe(d)
    expect(adicionarKm(d, {}, 'XX', 0)).toBe(d)
    expect(adicionarKm(diarioVazio(), {}, 'EF456GH', 50).km).toEqual([{ chave: 'EF456GH', antes: null, escrito: 50 }])
  })
  it('planearDesfazer: repõe antes / remove a chave nova / não toca em outros camiões', () => {
    let d = adicionarKm(diarioVazio(), { AB123CD: 1000, ZZ999ZZ: 7 }, 'AB123CD', 1200)
    d = adicionarKm(d, { AB123CD: 1200, ZZ999ZZ: 7 }, 'EF456GH', 2000)
    const p = planearDesfazer(d, { AB123CD: 1200, EF456GH: 2000, ZZ999ZZ: 7 }, { tipo: null, valor: null })
    expect(p.bloqueios).toEqual([])
    expect(p.mapaNovo).toEqual({ AB123CD: 1000, ZZ999ZZ: 7 })
    expect(p.revertidos).toBe(2)
  })
  it('valor entretanto alterado por outra via → bloqueio (tudo ou nada)', () => {
    const d = adicionarKm(diarioVazio(), { AB123CD: 1000 }, 'AB123CD', 1200)
    const p = planearDesfazer(d, { AB123CD: 5555 }, { tipo: null, valor: null })
    expect(p.bloqueios.length).toBe(1)
  })
  it('escrita que nunca aconteceu (valor ainda é o antes) → nada a fazer, sem bloqueio', () => {
    const d = adicionarKm(diarioVazio(), { AB123CD: 1000 }, 'AB123CD', 1200)
    const p = planearDesfazer(d, { AB123CD: 1000 }, { tipo: null, valor: null })
    expect(p.bloqueios).toEqual([])
    expect(p.mudouMapa).toBe(false)
  })
  it('tracteur: repõe A só se o actual ainda é B', () => {
    const d = adicionarTracteur(diarioVazio(), 'immat', 'AB-123-CD', 'immat', 'EF-456-GH')
    expect(planearDesfazer(d, {}, { tipo: 'immat', valor: 'EF-456-GH' }).restaurarTracteur).toEqual({ tipo: 'immat', valor: 'AB-123-CD' })
    expect(planearDesfazer(d, {}, { tipo: 'immat', valor: 'AB-123-CD' }).restaurarTracteur).toBeNull()
    expect(planearDesfazer(d, {}, { tipo: 'parc', valor: '77' }).bloqueios.length).toBe(1)
  })
})

describe('desfazerTroca — fluxo completo sobre armazenamento', () => {
  const inicial = () => armazem({
    km_por_camiao: JSON.stringify({ AB123CD: 1000, ZZ999ZZ: 7 }),   // 1000 = km final do serviço anterior com A
    tracteur_type: 'immat', tracteur_value: 'AB-123-CD',
    historique: '[{"id":"prev"}]', historique_substituidos: '[{"id":"old"}]', km_ultimo_fim: '1000',
  })
  it('serviço curto com troca A→B descartado: km de A, km de B e camião actual voltam ao que eram', async () => {
    const a = inicial()
    // continuer le jour (A, km fim 1050)
    await registarEfeitoKm(a.s, 'AB-123-CD', 1050); await gravarKm(a, 'AB-123-CD', 1050)
    // camion B (km inicial 3000)
    await registarEfeitoTracteur(a.s, 'immat', 'EF-456-GH')
    a.dados.tracteur_type = 'immat'; a.dados.tracteur_value = 'EF-456-GH'
    await registarEfeitoKm(a.s, 'EF-456-GH', 3000); await gravarKm(a, 'EF-456-GH', 3000)
    expect(mapa(a)).toEqual({ AB123CD: 1050, ZZ999ZZ: 7, EF456GH: 3000 })
    const r = await desfazerEfeitosDeTroca(a.s)
    expect(r.estado).toBe('desfeito')
    expect(mapa(a)).toEqual({ AB123CD: 1000, ZZ999ZZ: 7 })
    expect(a.dados.tracteur_value).toBe('AB-123-CD')
    expect(a.dados.tracteur_type).toBe('immat')
    expect(a.dados[CHAVE_DESFAZER]).toBeUndefined()
  })
  it('NÃO toca no histórico, nos substituídos nem em km_ultimo_fim', async () => {
    const a = inicial()
    const antes = { h: a.dados.historique, s: a.dados.historique_substituidos, k: a.dados.km_ultimo_fim }
    await registarEfeitoKm(a.s, 'AB-123-CD', 1050); await gravarKm(a, 'AB-123-CD', 1050)
    await desfazerEfeitosDeTroca(a.s)
    expect({ h: a.dados.historique, s: a.dados.historique_substituidos, k: a.dados.km_ultimo_fim }).toEqual(antes)
  })
  it('camião B sem km anterior: a chave nova é removida (não fica km de teste)', async () => {
    const a = armazem({ tracteur_type: 'immat', tracteur_value: 'AB-123-CD' })
    await registarEfeitoTracteur(a.s, 'immat', 'EF-456-GH'); a.dados.tracteur_value = 'EF-456-GH'
    await registarEfeitoKm(a.s, 'EF-456-GH', 3000); await gravarKm(a, 'EF-456-GH', 3000)
    await desfazerEfeitosDeTroca(a.s)
    expect(mapa(a)).toEqual({})
    expect(a.dados.tracteur_value).toBe('AB-123-CD')
  })
  it('sem camião actual antes (primeira vez): tracteur_* voltam a ficar vazios', async () => {
    const a = armazem({})
    await registarEfeitoTracteur(a.s, 'immat', 'EF-456-GH'); a.dados.tracteur_type = 'immat'; a.dados.tracteur_value = 'EF-456-GH'
    const r = await desfazerEfeitosDeTroca(a.s)
    expect(r.estado).toBe('desfeito')
    expect(a.dados.tracteur_value).toBeUndefined()
    expect(a.dados.tracteur_type).toBeUndefined()
  })
  it('km alterado entretanto → BLOQUEADO: nada é escrito e o diário fica (dados preservados)', async () => {
    const a = inicial()
    await registarEfeitoKm(a.s, 'AB-123-CD', 1050); await gravarKm(a, 'AB-123-CD', 1050)
    a.dados.km_por_camiao = JSON.stringify({ AB123CD: 1900, ZZ999ZZ: 7 })   // outra via mexeu
    const snap = JSON.stringify(a.dados)
    const r = await desfazerEfeitosDeTroca(a.s)
    expect(r.estado).toBe('bloqueado')
    expect(JSON.stringify(a.dados)).toBe(snap)
  })
  it('sem troca (serviço curto simples) → nada a desfazer e nada escrito', async () => {
    const a = inicial()
    const snap = JSON.stringify(a.dados)
    const r = await desfazerEfeitosDeTroca(a.s)
    expect(r.estado).toBe('nada')
    expect(JSON.stringify(a.dados)).toBe(snap)
  })
  it('diário corrupto é ignorado (não rebenta nem desfaz às cegas)', async () => {
    const a = inicial(); a.dados[CHAVE_DESFAZER] = '{lixo'
    expect((await lerDiario(a.s)).km).toEqual([])
    expect((await desfazerEfeitosDeTroca(a.s)).estado).toBe('nada')
  })
})
