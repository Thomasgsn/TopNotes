# TopNotes

Bloc-notes pour la barre des menus macOS : une fenêtre toujours au premier plan, des notes en Markdown, des étiquettes, l'épinglage, l'archive et la corbeille. Interface en français, anglais, italien, espagnol et allemand.

Construit avec [Tauri 2](https://tauri.app) (Rust), Vue 3, TypeScript et l'éditeur [TipTap](https://tiptap.dev).

## Données

Tout reste en local, sans compte ni synchronisation.

| Élément                                | Emplacement                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| Notes, étiquettes et réglages          | `~/Library/Application Support/com.ths.topnotes/topnotes.json`                      |
| Sauvegardes quotidiennes (7 dernières) | `~/Library/Application Support/com.ths.topnotes/backups/topnotes-AAAA-MM-JJ.json`   |
| Fichier illisible mis de côté          | `~/Library/Application Support/com.ths.topnotes/topnotes.corrupt-<horodatage>.json` |

- Chaque modification est enregistrée automatiquement (~0,3 s après la dernière frappe), de façon atomique : fichier temporaire, `fsync`, puis renommage.
- Avant la première écriture de chaque jour (UTC), l'état précédent est copié dans `backups/`.
- Si le fichier vient d'une version plus récente de TopNotes, l'app l'explique et **n'écrit rien**.
- Pour restaurer une sauvegarde : quitter TopNotes, remplacer `topnotes.json` par la copie voulue, relancer.

En mode navigateur (`npm run dev` sans Tauri), les données vont dans le `localStorage` de la page.

## Développement

Prérequis : Node 24 (voir `.nvmrc`), Rust stable et les [prérequis Tauri pour macOS](https://tauri.app/start/prerequisites/).

```bash
npm install
```

```bash
npm run tauri dev
```

| Script                | Rôle                                                       |
| --------------------- | ---------------------------------------------------------- |
| `npm run dev`         | Interface seule dans le navigateur (http://localhost:1420) |
| `npm run tauri dev`   | Application native avec rechargement à chaud               |
| `npm run tauri build` | Application macOS (`.app` / `.dmg`)                        |
| `npm test`            | Tests front (`node --test`, jsdom)                         |
| `npm run test:rust`   | Tests de la persistance Rust                               |
| `npm run lint`        | ESLint, Stylelint et Prettier                              |
| `npm run typecheck`   | `vue-tsc --noEmit`                                         |

> **Attention :** `npm run tauri dev` utilise le même dossier de données que l'application installée. Pour tester sans toucher à vos notes, lancez le binaire avec un `HOME` temporaire :
>
> ```bash
> HOME=$(mktemp -d) src-tauri/target/debug/topnotes
> ```

## Structure

```
src/
  main.ts              démarrage : charge les données puis monte l'app
  persistence.ts       lecture/écriture (Tauri ou localStorage), migrations
  stores/notes.ts      notes, filtres, recherche, étiquettes, sauvegarde auto
  stores/settings.ts   langue, premier plan, lancement à la connexion
  editor/              extensions TipTap, Markdown, liens, raccourcis
  components/          panneaux (navigation, liste, éditeur) et dialogues
  *Messages.ts, i18n.ts  traductions
src-tauri/src/
  lib.rs               barre des menus, fenêtre, instance unique
  persistence.rs       fichier JSON atomique, sauvegardes, protection des données
tests/                 tests node:test
```

Les raccourcis clavier sont listés dans l'application (⌘/).
