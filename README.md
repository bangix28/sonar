# Sonar

Plugin BetterDiscord qui permet d'envoyer une **notification sonore ciblée** à un ami — un son qui
se déclenche chez lui même si le serveur est en sourdine, même s'il est en **Ne pas déranger**, même
si Discord est minimisé.

```
/sonar  ami:@Alice  son:Alarme  message:Réveille-toi
```

---

## Pourquoi un plugin, et pas juste un ping

Discord ne permet à **personne** de forcer un son chez quelqu'un d'autre. Ni les mentions, ni un bot,
ni les webhooks, ni l'API RPC locale. C'est un choix de conception assumé, cohérent avec sa politique
anti-harcèlement — les contournements découverts sont traités comme des bugs et corrigés.

Sonar prend donc le problème à l'envers : **c'est le destinataire qui installe le plugin**, et c'est
le plugin qui joue le son sur sa propre machine. Le levier technique est que le client Discord reçoit
l'événement `MESSAGE_CREATE` de la Gateway **indépendamment des réglages de notification** — la
sourdine et le Ne pas déranger n'agissent que sur l'affichage, jamais sur la réception. Sonar écoute
ce flux et déclenche sa propre lecture audio, sans exploiter aucune faille.

Corollaire : **tout le monde doit installer le plugin**, émetteur comme destinataire.

---

## Ce que Sonar ne fait pas

- **Il ne réveille que les clients allumés.** Si Discord est fermé, le signal est perdu — Discord ne
  rejoue jamais les messages manqués. L'option « Rattraper les Sonars manqués » couvre la coupure
  réseau courte (moins de 5 minutes), pas l'application fermée.
- **Il ne fonctionne pas sur mobile ni sur Discord Web.** BetterDiscord est un mod du client desktop.
- **Il ne contourne pas le mixeur de volume de Windows.** Voir Dépannage.

---

## Installation

### 1. Prérequis

[BetterDiscord](https://betterdiscord.app/) installé (version 1.14 ou plus récente).

### 2. Déposer le plugin

Télécharger **[Sonar.plugin.js](https://github.com/bangix28/sonar/releases/latest/download/Sonar.plugin.js)**
(aucun compte GitHub nécessaire) et le copier dans :

```
%AppData%\BetterDiscord\plugins
```

Raccourci : coller `%AppData%\BetterDiscord\plugins` dans la barre d'adresse de l'Explorateur.

C'est tout : au démarrage, Sonar télécharge ses sons dans `plugins\sounds\` et installe ses mises à
jour tout seul depuis ce dépôt (désactivable, bouton « Vérifier les mises à jour » dans Général).
L'updater de BetterDiscord, lui, ne connaît pas Sonar : il ne suit que les addons de sa boutique.

Puis l'activer dans **Paramètres Discord → Plugins → Sonar**.

### 3. Créer le salon de signalisation

Les signaux Sonar transitent par un salon texte dédié d'un serveur privé que vous partagez.

1. Sur votre serveur, créer un salon texte, par exemple `#sonar`.
2. Y faire un **clic droit → « Définir comme salon Sonar »**.

Alternative : se placer dans le salon et taper `/sonar-ici`.

> Toutes les personnes qui veulent s'envoyer des Sonars doivent avoir **le même salon** configuré et
> y avoir accès en lecture.

### 4. Choisir ses sons

Dans les réglages du plugin, section **Sons**, cliquer sur « Parcourir » en face de chaque son et
choisir un fichier audio sur votre disque (`.ogg`, `.mp3`, `.wav`, `.m4a`, `.flac`, `.opus`).

Chacun mappe ses propres fichiers : l'émetteur choisit un *nom* de son (`alarme`, `klaxon`…), le
destinataire décide quel fichier correspond à ce nom chez lui. Rien n'est transféré.

Le bouton **« Écouter »** permet de tester immédiatement.

Pour tester toute la chaîne de réception en solo (on ne peut pas s'auto-sonner), Général →
**« Simuler une réception »** : choisis le son, clique « Simuler ». Son et alertes se déclenchent comme
pour un vrai Sonar, sans rien envoyer, en ignorant cooldowns et allowlist.

### 5. Autoriser ses amis

Section **Garde-fous**. Par défaut l'allowlist est **vide** : personne ne peut vous faire sonner tant
que vous n'avez autorisé personne. C'est volontaire.

- Bouton **« Importer mes amis Discord »**, ou
- Coller les IDs Discord à la main (séparés par des virgules).

Pour copier un ID : activer **Paramètres → Avancés → Mode développeur**, puis clic droit sur une
personne → « Copier l'identifiant ».

---

## Utilisation

| Moyen | Comment |
|---|---|
| **Commande slash** | `/sonar ami:@Alice son:Alarme message:…` — le son et le message sont optionnels |
| **Clic droit** | Sur un ami (liste des membres, un de ses messages, son profil) → « Envoyer un Sonar » |

La commande `/sonar` n'apparaît qu'une fois le salon configuré.

---

## Réglages

### Général
- **ID du salon Sonar** — rempli automatiquement par le clic droit ou `/sonar-ici`.
- **Mentionner le destinataire** — ajoute le ping Discord natif en secours, utile si la personne n'a
  pas (encore) le plugin.
- **Rattraper les Sonars manqués** — rejoue à la reconnexion les signaux de moins de 5 minutes.
- **Diagnostic** — vérifie les modules internes, le salon et les fichiers son. **C'est le premier
  réflexe quand quelque chose ne marche plus.**

### Sons
Volume général, volume maximum (protection auditive, appliqué en dernier), suivi du volume de sortie
Discord, comportement en cas de sons simultanés, puis un fichier + un volume + un bouton de test par
son.

### Alerte visuelle
Notification dans Discord, notification Windows, clignotement de la barre des tâches. Les trois sont
indépendants et cumulables.

### Garde-fous
- **Allowlist** — qui a le droit de vous faire sonner. Vide par défaut.
- **Cooldown par émetteur** (30 s par défaut) et **cooldown global** (5 s) — le second empêche
  plusieurs personnes de contourner le premier en se coordonnant. Plancher non désactivable de 5 s.
- **Heures calmes** — plage où Sonar reste silencieux. Gère correctement une plage qui franchit
  minuit (22:00 → 07:00).
- **Respecter le mode Streamer** — silence quand le mode Streamer de Discord est actif.

---

## Dépannage

**« Je n'entends rien »** — dans l'ordre :

1. **Diagnostic** dans les réglages du plugin : il distingue un module cassé d'un salon mal
   configuré d'un fichier son illisible.
2. **Mixeur de volume de Windows** — `Paramètres → Système → Son → Mixeur de volume`. Le son de Sonar
   sort du process Discord et subit son curseur. Si vous avez baissé Discord à 20 % pour le vocal,
   votre Sonar est à 20 % aussi. C'est la cause numéro un.
3. **Allowlist** — l'émetteur est-il autorisé chez vous ?
4. **Cooldown** — un deuxième Sonar dans les 30 s suivant le premier est bloqué par construction.
5. **Heures calmes** et **mode Streamer**.
6. Un bandeau « lecture audio bloquée » peut apparaître au tout premier lancement : cliquer n'importe
   où dans Discord débloque le contexte audio, c'est une protection de Chromium.

**« La commande /sonar n'existe pas »** — le salon n'est pas configuré. La commande est masquée tant
que c'est le cas.

**« Le plugin a disparu après une mise à jour de Discord »** — BetterDiscord se désinjecte à certaines
mises à jour. Fermer Discord **complètement** (y compris l'icône dans la zone de notification),
relancer l'installeur BetterDiscord et cliquer sur « Repair ».

**« Ça marchait, ça ne marche plus du tout »** — lancer le **Diagnostic**. Une ligne rouge signifie
que Discord a renommé un module interne : c'est attendu sur ce type de plugin, et la réparation est
localisée dans la section `§1 Modules` du fichier.

**La notification Windows n'apparaît pas** — l'Assistant de concentration / Ne pas déranger de
Windows 11 peut l'étouffer. Le son, lui, passe toujours : c'est pour ça que le visuel est un bonus et
le son le canal principal.

---

## Développement

```powershell
# Lien symbolique vers le dossier plugins : BetterDiscord recharge à chaque sauvegarde
.\scripts\dev-link.ps1

# Tests (Node seul, aucune dépendance)
node tests\protocol.test.js   # protocole et heures calmes, en isolation
node tests\smoke.test.js      # charge le plugin contre de faux modules Discord
```

Pas de build : le fichier source **est** le fichier distribué.

**Publier une version** : augmenter `@version` dans `Sonar.plugin.js`, ajouter l'entrée au
CHANGELOG, puis `git push` sur `main`. Les plugins installés la récupèrent d'eux-mêmes (au
démarrage ou toutes les 6 h). Un son ajouté dans `sounds/` (nommé d'après un id du catalogue) est
distribué de la même façon. Créer une release (`gh release create vX.Y.Z Sonar.plugin.js`) ne sert
qu'au lien de première installation.

`smoke.test.js` charge `Sonar.plugin.js` exactement comme BetterDiscord le fait (`new Function` avec
`require`/`module` injectés) contre un faux dispatcher Flux, et vérifie le cycle de vie complet :
abonnement, réception, garde-fous, déduplication, émission, panneau de réglages, et nettoyage au
`stop()`. Il ne remplace pas les tests manuels dans Discord — il attrape les régressions de câblage.

Architecture interne, découpage en sections et pièges connus : voir le plan de conception et
[`docs/PROTOCOL.md`](docs/PROTOCOL.md) pour le format des signaux.

Règle structurante : **`§1 Modules` est le seul endroit du fichier qui touche `BdApi.Webpack`.** Quand
Discord casse quelque chose, la réparation tient dans ces ~60 lignes.

---

## Conditions d'utilisation et éthique

BetterDiscord viole techniquement les conditions d'utilisation de Discord. En pratique, aucun cas de
bannissement n'est documenté pour un usage non abusif, mais le risque n'est pas nul et vous
l'assumez. Sonar n'automatise rien : chaque envoi est déclenché par un geste humain explicite, ce qui
le distingue d'un self-bot — c'est l'automatisation des comptes utilisateur que Discord sanctionne.

Un outil qui perce volontairement le Ne pas déranger est à un cran du harcèlement. Deux défauts sont
inscrits dans le produit et ne sont pas négociables :

- **Allowlist vide par défaut** — personne ne peut vous faire sonner sans votre accord explicite.
- **Cooldown plancher de 5 secondes**, non désactivable, doublé d'un cooldown global.

Utilisez-le entre gens consentants.
