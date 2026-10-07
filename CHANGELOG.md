# Changelog

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [0.3.4] — 2026-10-07

### Corrigé
- **« Envoyer un Sonar » absent du clic droit sur un participant de salon vocal.** Les props reçus
  par le patch sont ceux du composant qui rend le menu, pas forcément `{user}`. `findMenuUser`
  cherche `user`, `userId`, les props du menu, puis un objet utilisateur sous une autre clé. Un menu
  sans utilisateur reconnu journalise ses clés de props (console, niveau info) pour le débogage.

## [0.3.3] — 2026-10-07

### Corrigé
- **Mise à jour en retard après un push.** Le CDN `raw.githubusercontent.com` ignore la query string
  anti-cache et sert l'ancienne version plusieurs minutes. Le plugin est désormais lu via l'API GitHub
  (`Accept: application/vnd.github.raw`), à jour dès le push.

## [0.3.2] — 2026-10-07

### Ajouté
- **« Envoyer un Sonar » depuis un salon vocal.** Le menu contextuel est maintenant ajouté à tous les
  menus dont le `navId` contient `user` (participant d'un salon vocal, profil…), et plus seulement à
  `user-context`. Les menus qui ne fournissent qu'un `userId` sont gérés, et l'entrée n'apparaît
  qu'une fois si deux menus imbriqués correspondent.

## [0.3.1] — 2026-10-07

### Corrigé
- **Clic droit → « Envoyer un Sonar » plus fiable.** L'entrée était masquée sans salon configuré, et
  un `push` sur `props.children` levait une exception (avalée par BetterDiscord) quand Discord rend
  le menu en élément unique. L'entrée est désormais toujours visible — sans salon, elle explique
  quoi faire — et l'ajout gère les deux formes de menu.

## [0.3.0] — 2026-10-07

### Ajouté
- **Mise à jour intégrée.** L'updater de BetterDiscord ignore `@updateUrl` et ne suit que les addons
  de sa boutique : Sonar se met donc à jour lui-même depuis `github.com/bangix28/sonar`. Vérification
  15 s après le démarrage puis toutes les 6 h ; la nouvelle version est écrite à la place de
  `Sonar.plugin.js` et BetterDiscord la recharge. Réglage « Mises à jour automatiques » (activé par
  défaut ; désactivé, un bandeau propose « Mettre à jour ») et bouton « Vérifier les mises à jour ».
- **Sons téléchargés automatiquement.** Les sons du dossier `sounds/` du dépôt absents en local sont
  téléchargés dans `plugins\sounds\`. Installer Sonar = copier le seul `Sonar.plugin.js`.
- Version installée affichée dans les réglages et le Diagnostic.

### Notes techniques
- Le fichier distant est validé (en-tête, `@name Sonar`, `module.exports`, taille) et la version
  comparée numériquement (`0.10.0 > 0.2.0`) ; une version illisible ne déclenche jamais d'écriture.
- Un `Sonar.plugin.js` qui est un lien symbolique (`scripts/dev-link.ps1`) n'est jamais écrasé.
  `lstatSync` du polyfill BD suit les liens : la détection compare `realpathSync` au chemin.

## [0.2.0] — 2026-10-07

### Ajouté
- **Sons trouvés automatiquement.** Quand aucun fichier n'est choisi pour un son, le plugin cherche
  `<son>.<ext>` (`meurs.ogg`, `le-tue.mp3`…) dans `plugins\sounds\` puis `plugins\sonar-sounds\`.
  Distribuer le plugin revient à copier `Sonar.plugin.js` et le dossier `sounds` dans le dossier
  plugins, sans « Parcourir » chez chaque destinataire. Un fichier choisi à la main reste prioritaire.
- La note de chaque son indique « Trouvé automatiquement : … », et le Diagnostic compte ces sons.

### Modifié
- Le message « aucun fichier pour ce son » de « Écouter » et « Simuler » indique où déposer le fichier.

## [0.1.1] — 2026-10-05

Corrections trouvées au premier test réel dans Discord, en inspectant le code de
`betterdiscord.asar` effectivement exécuté.

### Corrigé
- **Tous les boutons du panneau de réglages étaient inertes.** Pour un réglage `type: "button"`,
  BetterDiscord rend son composant Button et lui injecte `onChange` — que le Button ignore, car il
  n'écoute que `onClick`. « Diagnostic », « Importer mes amis » et les cinq boutons « Écouter » ne
  faisaient donc rien. Les boutons sont désormais câblés via `onClick`, et une assertion de
  régression vérifie que tout bouton déclaré en a un.
- **Aucun retour après le choix d'un fichier son.** Le composant `file` de BetterDiscord n'affiche
  jamais le chemin sélectionné : rien n'indiquait si le son avait été pris en compte. Un toast
  confirme maintenant le fichier retenu (ou signale qu'il est illisible), et la note du réglage
  rappelle le fichier courant à la réouverture des réglages.
- **`enableWith` retiré des heures calmes.** Dans une catégorie, BetterDiscord 1.14.1 applique
  `disabled = valeur` au lieu de `disabled = !valeur` — la branche racine, elle, négocie
  correctement. Activer « Heures calmes » aurait grisé les champs début/fin. Le plugin ne s'appuie
  pas sur ce comportement inversé.

## [0.1.0] — 2026-10-05

Première version.

### Ajouté
- Réception des signaux via le flux `MESSAGE_CREATE`, insensible à la sourdine du salon et du serveur
  ainsi qu'au statut Ne pas déranger.
- Lecture de sons depuis des fichiers locaux (`.ogg`, `.mp3`, `.wav`, `.m4a`, `.flac`, `.opus`), avec
  cache invalidé au `mtime` du fichier.
- Commande slash `/sonar` (destinataire, son, message) et `/sonar-ici` pour définir le salon courant.
- Menu contextuel « Envoyer un Sonar » sur un utilisateur, et « Définir comme salon Sonar » sur un salon.
- Alerte visuelle sur trois canaux indépendants : notification BetterDiscord, notification Windows
  native, clignotement de la barre des tâches.
- Garde-fous : allowlist (vide par défaut), cooldown par émetteur et cooldown global avec plancher
  non désactivable de 5 s, heures calmes gérant le passage par minuit, respect du mode Streamer,
  interrupteur global.
- Volume général, volume par son, plafond de protection auditive, suivi du volume de sortie Discord,
  et politique de superposition des sons (couper / file d'attente / superposer).
- Bouton **Diagnostic** : état de chaque module interne, du salon et des fichiers son.
- Rattrapage best-effort des signaux de moins de 5 minutes à la reconnexion.
- Protocole de signal versionné, documenté dans `docs/PROTOCOL.md`.

### Notes techniques
- Toute la résolution de modules Discord est confinée à la section `§1 Modules`, avec cascades de
  repli sur le dispatcher (3 voies) et sur le module d'envoi (2 voies).
- `new Audio("file:///…")` ne fonctionne pas sous Chromium ; la lecture passe par
  `fs.readFileSync(path, "base64")` → `Blob` → `URL.createObjectURL`.
- Le polyfill `fs` de BetterDiscord utilise `"utf-8"` comme encodage par défaut, pas `null` :
  l'encodage est toujours passé explicitement.

### Limites connues
- Ne réveille que les clients Discord allumés : Discord ne rejoue jamais les `MESSAGE_CREATE` manqués.
- Desktop uniquement (BetterDiscord ne couvre ni le mobile ni Discord Web).
- Le son sort du process Discord et subit donc son curseur dans le mixeur de volume de Windows.
- `DiscordNative.window.flashFrame` n'est pas documenté publiquement : le clignotement de la barre
  des tâches tente la voie native puis un module webpack, et retombe sur un clignotement du titre de
  fenêtre qui fonctionne partout.
