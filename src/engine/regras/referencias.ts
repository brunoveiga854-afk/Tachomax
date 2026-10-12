// src/engine/regras/referencias.ts
// Referências regulamentares usadas pelo motor, com o nível real de verificação (verificadas em 12/10/2026).
// Fontes consultadas: texto do art. 8.º do Reg. (CE) 561/2006 (legislation.gov.uk, versão revista);
// portal oficial Your Europe (UE); Ministère de la Transition écologique (temps de travail des
// conducteurs routiers); DEETS Mayotte (fiche oficial sobre durée du travail du personnel roulant);
// Ministère (annexe «Données sociales du TRM 2022»); Assemblée nationale (QE 15140).
// O texto primário de R3312-50/51 (Légifrance/Doctrine) estava bloqueado a leitura automática: os valores
// de R3312-50/51 vêm de sínteses oficiais e ficam marcados 'fonte_oficial_secundaria'.
import type { Referencia } from './tipos'

export const REF = {
  CE561_ART8_2: {
    id: 'Reg. (CE) 561/2006, art. 8.º n.º 2',
    texto:
      'Em cada período de 24 horas após o fim do descanso diário/semanal anterior, o condutor deve gozar um novo descanso diário. Normal ≥11h; reduzido ≥9h e <11h.',
    verificacao: 'texto_oficial_lido',
  },
  CE561_ART8_4: {
    id: 'Reg. (CE) 561/2006, art. 8.º n.º 4',
    texto: 'Entre dois descansos semanais, no máximo três descansos diários reduzidos.',
    verificacao: 'texto_oficial_lido',
  },
  CE561_ART8_5: {
    id: 'Reg. (CE) 561/2006, art. 8.º n.º 5',
    texto: 'Condução em equipagem: novo descanso diário de ≥9h nas 30h seguintes (regime não suportado pelo motor).',
    verificacao: 'texto_oficial_lido',
  },
  CE561_ART8_2_FRACIONADO: {
    id: 'Reg. (CE) 561/2006, art. 8.º n.º 2 (fracionado)',
    texto: 'Descanso diário fracionado em 3h + 9h (total ≥12h): regime não suportado pelo motor.',
    verificacao: 'fonte_oficial_secundaria',
  },
  L3312_1: {
    id: 'Code des transports, L3312-1',
    texto:
      'Quando parte do trabalho é efetuada entre 0h e 5h, a duração diária do trabalho não pode exceder 10 horas.',
    verificacao: 'fonte_oficial_secundaria',
  },
  L3312_2: {
    id: 'Code des transports, L3312-2',
    texto:
      'Pausa de ≥30 min quando o trabalho diário ultrapassa 6h e de ≥45 min quando ultrapassa 9h; fracionável em períodos de ≥15 min; não mais de 6h consecutivas sem pausa.',
    verificacao: 'fonte_oficial_secundaria',
  },
  R3312_51: {
    id: 'Code des transports, R3312-51',
    texto: 'Duração máxima diária do tempo de serviço: 12 horas.',
    verificacao: 'fonte_oficial_secundaria',
  },
  R3312_50: {
    id: 'Code des transports, R3312-50',
    texto:
      'Duração máxima semanal do tempo de serviço numa semana isolada: grands routiers/longue distance 56h; outros condutores de mercadorias 52h; messagerie e transporte de fundos 48h. Médias (53h/50h/44h) em período de referência: não suportadas.',
    verificacao: 'fonte_oficial_secundaria',
  },
  DIR_2002_15: {
    id: 'Diretiva 2002/15/CE, arts. 3.º-a, 4.º, 7.º',
    texto:
      'TEMPO DE TRABALHO (distinto de tempo de serviço): média 48h/semana em 4 meses (máx. 60h numa semana); trabalho noturno ≤10h em 24h. Exclui períodos de disponibilidade: a app não os mede.',
    verificacao: 'fonte_oficial_secundaria',
  },
  CE561_ART6_7: {
    id: 'Reg. (CE) 561/2006, arts. 6.º e 7.º',
    texto:
      'TEMPO DE CONDUÇÃO: 9h/dia (10h duas vezes por semana), 56h/semana, 90h em duas semanas; pausa de 45 min após 4h30 de condução. A app não mede condução separadamente.',
    verificacao: 'fonte_oficial_secundaria',
  },
} satisfies Record<string, Referencia>
