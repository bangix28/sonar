# Sons

Ce dossier est l'endroit conseillé pour ranger vos fichiers audio, mais le plugin ne l'impose pas :
dans les réglages, chaque son pointe vers un **chemin absolu** choisi via « Parcourir ».

Aucun fichier audio n'est fourni avec le dépôt — le choix des sons est personnel, et c'est l'un des
rares endroits où un défaut imposé serait plus gênant qu'utile.

## Catalogue attendu

Le protocole v1 définit dix identifiants : `ping`, `alarme`, `klaxon`, `cloche`, `urgence`, `meurs`, `cul`,
`le-tue`, `merde`, `recommence`.

Seul l'identifiant circule sur le réseau. **Chaque personne décide quel fichier correspond à quel
identifiant chez elle** — si Alice vous envoie un `klaxon`, c'est *votre* fichier klaxon qui joue.

## Conseils de choix

- **Format** : `.ogg` ou `.opus` de préférence (légers, lecture native dans Chromium). `.mp3`,
  `.wav`, `.m4a` et `.flac` fonctionnent aussi.
- **Durée** : 1 à 3 secondes. Un son long est perçu comme agressif et se superpose mal.
- **Niveau** : normaliser autour de **-14 LUFS**. Un fichier source trop faible ne se rattrape pas
  avec le curseur de volume, qui est plafonné à 1.0.
- **Attaque franche** : un son qui démarre fort est bien plus efficace pour percer un environnement
  bruyant qu'un son avec un fondu d'entrée.

## Où en trouver

[freesound.org](https://freesound.org/) et [Pixabay Sound Effects](https://pixabay.com/sound-effects/)
proposent des sons sous licences permissives. Vérifiez la licence si vous redistribuez le dossier à
vos amis.

## Normaliser avec ffmpeg

```powershell
ffmpeg -i source.wav -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a libvorbis -q:a 5 alarme.ogg
```
