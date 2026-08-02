# Traitement de vos documents par intelligence artificielle

## Quels documents sont envoyés

Lorsque vous utilisez la fonction "Charger les documents" pour analyser une fiche de paie ou un bulletin de frais, le document complet (image ou PDF) est transmis à un service d'intelligence artificielle pour en extraire automatiquement les informations (salaire, heures travaillées, montants de frais, dates, nom du conducteur, nom de l'entreprise).

## Comment vos données circulent

1. Le document est envoyé depuis votre téléphone vers notre serveur relais (hébergé sur Netlify).
2. Notre serveur transmet immédiatement le document à l'API d'Anthropic (Claude), qui effectue l'analyse.
3. La réponse est renvoyée à votre téléphone et traitée localement.

Notre serveur relais ne conserve, n'enregistre et n'analyse à aucun moment le contenu de vos documents — il agit uniquement comme un intermédiaire technique. Aucune copie de vos documents ni des données qu'ils contiennent n'est stockée sur nos serveurs.

## Ce que fait Anthropic de ces données

Anthropic, fournisseur du modèle d'IA utilisé, n'utilise pas par défaut les données transmises via son API pour entraîner ses modèles. Pour plus d'informations, consultez la politique de confidentialité d'Anthropic : https://www.anthropic.com/privacy

## Où vos données restent ensuite

Une fois l'analyse terminée, les informations extraites (salaire, heures, frais, etc.) sont stockées uniquement sur votre téléphone, de manière sécurisée (SecureStore), et ne sont pas envoyées vers un serveur central de TachoOffice.

## Vos choix

- Vous pouvez modifier ou corriger manuellement toute information extraite par l'IA avant de la valider.
- L'utilisation de cette fonctionnalité est optionnelle — vous pouvez saisir vos données manuellement si vous préférez ne pas transmettre vos documents à un service d'IA.
