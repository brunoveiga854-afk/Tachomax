/**
 * ROUTEMAX — Internacionalização
 * Français + Português
 */

export const translations = {
  fr: {
    // Navigation
    nav: {
      aujourdhui: "Aujourd'hui",
      historique: 'Historique',
      fiche: 'Fiche paye',
      reglages: 'Réglages',
    },

    // Ecrã principal
    home: {
      bonjour: 'Bonjour',
      demarrer: 'DÉMARRER',
      pause: 'PAUSE',
      reprendre: 'REPRENDRE',
      terminer: 'TERMINER',
      enService: 'EN SERVICE',
      enPause: 'EN PAUSE',
      pauseDepuis: 'En pause depuis',
      debutDepuis: 'Démarré à',
      conduite: 'Conduite',
      pauseObligatoire: 'Pause obligatoire dans',
      pauseMaintenant: 'Pause obligatoire maintenant !',
    },

    // Découché
    decouche: {
      label: 'Découché ce soir',
      sub: 'Frais appliqués automatiquement',
    },

    // Types de jour
    types: {
      TRAB: 'Travail',
      DEC: 'Découché',
      FER: 'Férié',
      FERIE: 'Congé',
      RC: 'Repos Comp.',
      OFF: 'Repos',
    },

    // Limites
    limites: {
      conduiteJour: 'Conduite aujourd\'hui',
      serviceSemaine: 'Service semaine',
      conduite2sem: 'Conduite 2 semaines',
      amplitude: 'Amplitude',
    },

    // Frais
    frais: {
      casseCroute: 'Casse-croûte',
      petitDej: 'Petit déjeuner',
      repasMidi: 'Repas midi',
      repasSoir: 'Repas soir',
      repasNuit: 'Repas nuit',
      decouche: 'Découché',
      total: 'Total frais',
    },

    // Onboarding
    onboarding: {
      bienvenue: 'Bienvenue',
      soustitre: "L'app du chauffeur professionnel",
      profilQuestion: 'Quel est ton profil habituel ?',
      profilHint: 'Tu pourras changer à tout moment.',
      CD: 'Courte Distance',
      CDdesc: 'Je rentre à la maison tous les jours.',
      MIXTE: 'Mixte',
      MIXTEdesc: 'Surtout local, 1–2 découchés par semaine.',
      LD: 'Longue Distance',
      LDdesc: 'Je fais découché toute la semaine.',
      commencer: 'COMMENCER →',
    },

    // Trial
    trial: {
      joursRestants: 'jours d\'essai restants',
      expireBientot: 'Ton essai se termine bientôt',
      expire: 'Essai terminé',
      abonner: "S'abonner — 2,99€/mois",
      continuer: 'Continuer l\'essai',
    },

    // Fiche de paye
    fiche: {
      titre: 'Fiche de Paye',
      sousTitre: "L'app lit tout — toi tu vérifies",
      importer: 'IMPORTER MA FICHE',
      importerSub: 'Photo, scan ou PDF depuis ton téléphone',
      iaLecture: 'Lecture automatique IA',
      confirmer: '✓ CONFIRMER ET APPLIQUER',
      tauxHoraire: 'Taux horaire brut',
      fraisRepas: 'Frais repas',
      decouche: 'Découché',
      majoration: 'Majoration heures supp.',
      decalage: 'Décalage paiement',
    },

    // Rapport
    rapport: {
      titre: 'Rapport mensuel',
      totalService: 'Total service',
      totalConduite: 'Total conduite',
      totalFrais: 'Total frais',
      estimatifBrut: 'Estimatif brut',
      estimatifNet: 'Estimatif net',
      decalageInfo: 'Ces heures seront payées en',
      exporter: 'Exporter PDF',
    },
  },

  pt: {
    nav: {
      aujourdhui: 'Hoje',
      historique: 'Histórico',
      fiche: 'Recibo pag.',
      reglages: 'Definições',
    },

    home: {
      bonjour: 'Bom dia',
      demarrer: 'INICIAR',
      pause: 'PAUSA',
      reprendre: 'RETOMAR',
      terminer: 'TERMINAR',
      enService: 'EM SERVIÇO',
      enPause: 'EM PAUSA',
      pauseDepuis: 'Em pausa desde',
      debutDepuis: 'Iniciado às',
      conduite: 'Condução',
      pausaObrigatoria: 'Pausa obrigatória em',
      pausaMaintenant: 'Pausa obrigatória agora!',
    },

    decouche: {
      label: 'Découché esta noite',
      sub: 'Frais aplicados automaticamente',
    },

    types: {
      TRAB: 'Trabalho',
      DEC: 'Découché',
      FER: 'Feriado',
      FERIE: 'Férias',
      RC: 'RC',
      OFF: 'Descanso',
    },

    limites: {
      conduiteJour: 'Condução hoje',
      serviceSemaine: 'Serviço semana',
      conduite2sem: 'Condução 2 semanas',
      amplitude: 'Amplitude',
    },

    frais: {
      casseCroute: 'Casse-croûte',
      petitDej: 'Pequeno-almoço',
      repasMidi: 'Almoço',
      repasSoir: 'Jantar',
      repasNuit: 'Refeição noite',
      decouche: 'Découché',
      total: 'Total frais',
    },

    onboarding: {
      bienvenue: 'Bem-vindo',
      soustitre: 'A app do chauffeur profissional',
      profilQuestion: 'Qual é o teu perfil habitual?',
      profilHint: 'Podes mudar a qualquer momento.',
      CD: 'Curta Distância',
      CDdesc: 'Volto a casa todos os dias.',
      MIXTE: 'Misto',
      MIXTEdesc: 'Maioritariamente local, 1–2 découchés por semana.',
      LD: 'Longa Distância',
      LDdesc: 'Faço découché toda a semana.',
      commencer: 'COMEÇAR →',
    },

    trial: {
      joursRestants: 'dias de trial restantes',
      expireBientot: 'O teu trial termina em breve',
      expire: 'Trial terminado',
      abonner: 'Subscrever — 2,99€/mês',
      continuer: 'Continuar trial',
    },

    fiche: {
      titre: 'Recibo de Pagamento',
      sousTitre: 'A app lê tudo — tu só confirmas',
      importer: 'IMPORTAR O MEU RECIBO',
      importerSub: 'Foto, scan ou PDF do teu telemóvel',
      iaLecture: 'Leitura automática IA',
      confirmer: '✓ CONFIRMAR E APLICAR',
      tauxHoraire: 'Taxa horária bruta',
      fraisRepas: 'Frais refeição',
      decouche: 'Découché',
      majoration: 'Majoração horas extra',
      decalage: 'Desfasamento pagamento',
    },

    rapport: {
      titre: 'Relatório mensal',
      totalService: 'Total serviço',
      totalConduite: 'Total condução',
      totalFrais: 'Total frais',
      estimatifBrut: 'Estimativa bruta',
      estimatifNet: 'Estimativa líquida',
      decalageInfo: 'Estas horas serão pagas em',
      exporter: 'Exportar PDF',
    },
  },
}

export type Langue = keyof typeof translations
export type TranslationKeys = typeof translations.fr

export function t(langue: Langue, section: keyof TranslationKeys, key: string): string {
  const trans = translations[langue] as any
  return trans?.[section]?.[key] ?? key
}
