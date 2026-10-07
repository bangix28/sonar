# Protocole Sonar — version 1

Spécification du format des signaux échangés dans le salon Sonar.

## Format

```
🔊 SONAR|1|<@DESTINATAIRE>|SON|NONCE|message optionnel
```

Exemple réel :

```
🔊 SONAR|1|<@287654321098765432>|alarme|7f3a9c21|Réveille-toi, on commence
```

| Champ | Format | Rôle |
|---|---|---|
| `🔊` | `U+1F50A` | **Sentinelle.** Permet un préfiltre en O(1) sur le premier point de code, avant toute regex. |
| `SONAR` | littéral | Magic string, évite les faux positifs. |
| `1` | 1 à 2 chiffres | **Version du protocole.** Un parser v1 ignore proprement un signal `\|2\|`. |
| `<@ID>` | mention Discord, 15–25 chiffres | Destinataire. Lisible, cliquable, et offre un ping natif en secours. `<@!ID>` est accepté en lecture. |
| `SON` | `[a-z0-9_-]{1,24}` | Identifiant du son dans le catalogue partagé. |
| `NONCE` | 8 chiffres hexadécimaux | Clé de déduplication et identifiant de notification. |
| message | 0 à 200 caractères | Libre. Les `\|` y sont autorisés, les sauts de ligne sont écrasés en espaces à l'encodage. |

Longueur totale plafonnée à **320 caractères**.

## Catalogue de sons (v1)

`ping` · `alarme` · `klaxon` · `cloche` · `urgence` · `meurs` · `cul` · `le-tue` · `merde` · `recommence`

L'identifiant seul circule sur le réseau. **Chaque destinataire décide quel fichier local correspond
à quel identifiant** — aucun contenu audio n'est transmis.

## Décisions de conception

**Pourquoi du texte lisible plutôt que des caractères invisibles.** L'encodage en zero-width a été
écarté : plusieurs plugins BetterDiscord et Vencord populaires strippent les caractères invisibles
par anti-stéganographie, ce qui casserait le protocole chez un ami sans qu'il le sache ; et surtout,
un message cassé devient littéralement invisible à déboguer. Le format texte est grep-able,
inspectable à l'œil, et dégrade gracieusement : sans le plugin, l'ami voit un texte moche mais
compréhensible et reçoit la mention native.

**Pourquoi pas un embed.** `MessageActions.sendMessage` côté client ne crée pas d'embed riche — c'est
une capacité réservée aux bots. Ce serait possible en V2 avec un backend.

**Pourquoi une sentinelle d'un seul caractère.** Le handler `MESSAGE_CREATE` s'exécute sur *chaque
message de chaque salon de chaque serveur*. Le préfiltre `content.codePointAt(0) !== 0x1F50A` écarte
plus de 99,99 % du trafic pour le coût d'une comparaison d'entier, avant d'engager la regex.

**Pourquoi un nonce alors que les messages ont déjà un ID.** L'ID du message est la clé de dédup
principale, mais le rejeu après reconnexion relit les messages depuis le store local, où un même
signal peut se présenter sous une forme différente. Le nonce est le second filet.

## Regex de référence

```js
/^🔊 SONAR\|(\d{1,2})\|<@!?(\d{15,25})>\|([a-z0-9_-]{1,24})\|([0-9a-f]{8})(?:\|([\s\S]{0,200}))?$/
```

Ancrée aux deux bouts, une seule alternance, tous les quantificateurs bornés : aucun backtracking
catastrophique n'est possible, ce qui compte sur un flux de messages non fiable.

## Règles de traitement en réception

Dans cet ordre, du moins coûteux au plus coûteux :

1. Ignorer si `payload.optimistic` est vrai (écho local avant acquittement serveur).
2. Ignorer si le salon ne correspond pas au salon Sonar configuré.
3. Ignorer si le premier point de code n'est pas la sentinelle.
4. Ignorer si l'utilisateur courant n'est pas encore résolu — ne jamais deviner.
5. Ignorer si l'auteur est soi-même, ou un bot.
6. Parser ; ignorer si le parsing échoue ou si la version est inconnue.
7. Ignorer si le destinataire n'est pas soi-même.
8. Ignorer si l'ID du message ou le nonce a déjà été vu dans les 2 dernières minutes.
9. Appliquer les garde-fous (allowlist, cooldowns, heures calmes, mode Streamer).
10. Jouer le son, puis déclencher l'alerte visuelle — **même si le son a échoué**.

Les points 4, 5 et 7 sont trois protections cumulatives contre l'auto-ping. L'identifiant de
l'utilisateur courant ne doit **jamais** être mis en cache au démarrage : `getCurrentUser()` renvoie
`null` tant que la session n'est pas établie, et un cache à `undefined` comparé à un `undefined`
rendrait l'auto-ping systématique.

## Évolution

Toute modification incompatible incrémente la version. Un parser v1 rejette silencieusement les
versions qu'il ne connaît pas, donc un groupe peut migrer progressivement sans que les anciens
clients ne se mettent à faire n'importe quoi — ils cessent simplement de réagir.
