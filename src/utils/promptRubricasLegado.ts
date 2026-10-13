// src/utils/promptRubricasLegado.ts
// FICHEIRO GERADO por script a partir de app/(tabs)/fiche.tsx (importerImagens) — NÃO EDITAR À MÃO.
// Cópia byte-a-byte do prompt legado das fiches de paie e da instrução `system` usadas hoje.
// O teste promptRubricas.test.ts compara esta cópia com o fiche.tsx e FALHA se alguma divergir.
export const PROMPT_FICHES_LEGADO = `Tu es un expert en bulletins de salaire français transport routier.

RÈGLE ABSOLUE: lis TOUTES les lignes de chaque fiche de paye, sans exception. Ne te limite jamais aux totaux. Inspecte chaque ligne individuelle: salaire de base, heures normales, heures supplémentaires, primes, avantages en nature, intéressement, participation, remboursements, retenues, cotisations et net à payer.

Réponds UNIQUEMENT avec un JSON array sans markdown, exactement sous cette forme:
[{"tipo":"fiche","periode":"Avril 2026","moisIndex":3,"annee":2026,"netPaye":0,"salairebrut":0,"totalCotisations":0,"interessement":0,"primeExceptionnelle":0,"participationSalariale":0,"autresPrimes":0,"remboursementFrais":0,"entreprise":"","conducteur":"","joursConges":0,"montantConges":0,"joursFeries":0,"montantFeries":0,"joursRC":0,"montantRC":0,"totalHeures":0,"hbase":0,"hval":0,"h25":0,"lim25":0,"h50":0}]

Définition stricte des champs salaire:
- netPaye: montant “Net payé” APRÈS prélèvement à la source (PAS) — c’est la somme réellement virée sur le compte bancaire du salarié. NE PAS utiliser “Net à payer avant impôt sur le revenu”. NE PAS soustraire le PAS. Si la fiche affiche les deux valeurs, prendre uniquement la valeur finale après PAS.
- salairebrut: salaire brut de base/récurrent du bulletin, hors intéressement et primes exceptionnelles si elles sont affichées séparément.
- totalCotisations: total cotisations salariales.
- interessement: ligne intéressement versé, prime intéressement, ou versement équivalent (ex: 464.80). 0 si absent.
- primeExceptionnelle: prime exceptionnelle / prime non récurrente explicite. 0 si absent.
- participationSalariale: participation salariale / participation aux bénéfices. 0 si absent.
- autresPrimes: total de tout autre montant exceptionnel non récurrent qui ne doit PAS entrer dans netPaye (prime bilan, prime ponctuelle, avantage exceptionnel, régularisation exceptionnelle, etc.). 0 si absent.
- remboursementFrais: remboursement frais professionnels / frais de déplacement / indemnités non soumises si présent.

Définition des heures et coefficients:
- totalHeures: heures totales indiquées sur le bulletin.
- hbase: heures de base contractuelles (ex: 169h).
- hval: taux horaire de base en € (ex: 14.76).
- h25: taux horaire majoré 25% en € (ex: 18.45).
- lim25: nombre d'heures à 25% (ex: 17).
- h50: taux horaire majoré 50% en € (ex: 22.31).

Congés/absences:
- joursConges, montantConges, joursFeries, montantFeries, joursRC, montantRC: extrais les quantités et montants si les lignes existent.

Cherche explicitement toutes les lignes possibles: "Heures normales", "Heures supplémentaires 25%", "Heures supplémentaires 50%", "Intéressement", "Participation", "Prime exceptionnelle", "Avantage en nature", "Remboursement frais", "Frais professionnels", "Net à payer avant impôt", "Net payé".
Si une valeur n'existe pas sur le bulletin, mets 0. Ne fusionne jamais intéressement/participation/primes exceptionnelles dans netPaye.`

export const SYSTEM_EXTRACAO_LEGADO = 'Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown, sans texte avant ou après.'
