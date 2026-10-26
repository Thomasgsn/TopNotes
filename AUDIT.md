# Audit TopNotes — 26/10/2026

## 0. État des lieux

**Stack** : app de bureau macOS « barre de menus » — Tauri 2 (Rust) + Vue 3.5 `<script setup>` + TypeScript 6 + Vite 8, éditeur TipTap 3 (`@tiptap/markdown`), vue-i18n (fr/en/it/es/de), SCSS/BEM.

**Points d'entrée** : `src/main.ts` (charge les données puis monte `App.vue`), `src-tauri/src/lib.rs` (tray, fenêtre, commandes), `src-tauri/src/persistence.rs`.

**Modèle de données** (`src/types/Note.ts`, miroir Rust `Note`) : `{ id, title, body, bodyFormat?: "markdown", tag: string|null, pinned, archived, trashed, createdAt, updatedAt }`. Absence de `bodyFormat` = HTML hérité. Tags : `{ id, name, color }`.

**Stockage** :
- Tauri : un seul fichier `~/Library/Application Support/com.ths.topnotes/topnotes.json` (`schemaVersion: 1`), écrit en entier à chaque sauvegarde, de façon atomique (fichier temporaire + `fsync` + `rename` + `fsync` du répertoire). Un JSON illisible est mis de côté (`topnotes.corrupt-<ts>.json`).
- Navigateur (dev/preview) : `localStorage["topnotes.data.v1"]`.
- Migration des anciennes clés `localStorage` (`topnotes.notes.v1`…) vers le format courant.
- Sauvegarde auto debouncée à 320 ms (`stores/notes.ts:markDirty`), file d'écriture sérialisée côté TS, mutex côté Rust. Pas de sync distante.

**Résultat des outils (avant toute modification)** :

| Commande | Résultat |
|---|---|
| `npm run eslint` | ❌ 2 erreurs prettier (`eslint.config.ts`, `stylelint.config.mjs`) |
| `npm run stylelint` | ✅ |
| `npm run prettier` | ❌ 3 fichiers non formatés (dont `src/assets/styles/lib/_variables.scss`) |
| `npm run typecheck` | ❌ `nuxi: command not found` (reliquat Nuxt) |
| `npx vue-tsc --noEmit` | ✅ |
| `node --test tests/*.test.mjs` | ❌ 49/50 — `styles-architecture` exige « aucun `<style>` dans les .vue », or les 11 composants en ont |
| `cargo test` | ✅ 5/5 |
| `vite build` | ✅ (avertissement : chunk unique de 665 kB) |
| `vite` (mode navigateur) | ✅ démarre, aucune erreur console (5 warnings vue-i18n « HTML in message ») |

**Historique / intentions** : le dossier **n'est pas un dépôt git** (pas de `.git`) → impossible de lire l'historique, et impossible de faire des commits atomiques en phase 4 sans `git init`. Un seul TODO : `NavigationPanel.vue:169` (« connecter une BDD » — indicateur de sauvegarde). README = template Tauri par défaut. Dates de fichiers : grosse passe de travail le 23/10 (tags personnalisés, Markdown, raccourcis Slack, fenêtre détachée).

---

## 1. Bugs

| ID | Fichier(s) | Description | Impact | Effort |
|---|---|---|---|---|
| **B1** | `EditorPanel.vue` (menu actions), `stores/notes.ts:363` | « Supprimer définitivement » (note déjà dans la corbeille) supprime **sans confirmation ni annulation**. Le menu est à un clic du bouton « Restaurer ». | 🔴 Perte de données irréversible | S |
| **B2** | `MarkdownEditor.vue:28` (`onCreate`), `stores/notes.ts:329` | **Simplement ouvrir** une note HTML héritée la convertit en Markdown via `updateBody` → `updatedAt = now`. Vérifié dans l'app : la note passe à « À l'instant », remonte en tête de liste et entre dans le filtre « Aujourd'hui » sans avoir été modifiée. Les notes d'exemple (`i18n.ts` starter) sont encore en HTML, donc tout nouvel utilisateur le voit. | 🟠 Dates de modification faussées, tri incohérent | S |
| **B3** | `editor/markdown.ts` (sérialisation `@tiptap/markdown`) | Un paragraphe dont le texte commence par `- `, `1. `, `# ` ou vaut `---` est sérialisé tel quel et **rouvert comme liste / liste numérotée / titre / séparateur**. Reproduit : texte littéral « - pas une liste » → rouvert en `bulletList`. Arrive dès qu'on annule (⌘Z) l'auto-formatage. (`>`, ` ``` `, `[ ]` sont, eux, correctement échappés.) | 🟠 Contenu altéré à la réouverture | M |
| **B4** | `TagsDialog.vue` (bouton corbeille), `stores/notes.ts:223` | Supprimer un tag le retire **sans confirmation** de toutes les notes, sans annulation possible. | 🟠 Perte d'organisation (non récupérable) | S |
| **B5** | `stores/notes.ts:240-250`, `NavigationPanel.vue` footer | Échec d'écriture (disque plein, permissions, quota localStorage) : seul un `console.error`. Le pied de page affiche « Enregistrement… » indéfiniment, aucune alerte, **aucune nouvelle tentative** tant que l'utilisateur ne retape pas. | 🟠 Perte silencieuse si l'utilisateur ferme/quitte | S |
| **B6** | `stores/notes.ts:460-467` | « Quitter » depuis le tray : si la sauvegarde échoue, l'app ne quitte pas et n'affiche rien → l'utilisateur ne comprend pas, tente un kill forcé et perd les dernières modifications. | 🟡 | S |
| **B7** | `src-tauri/src/lib.rs`, `Cargo.toml` | Pas de garde « instance unique ». Si deux processus tournent (lancement au démarrage via LaunchAgent + lancement manuel, ou binaire lancé deux fois), chacun garde sa copie en mémoire et réécrit **tout** le fichier → le dernier écrivain écrase les notes de l'autre. *À confirmer sur macOS* (LaunchServices empêche souvent le doublon via Finder, pas forcément via LaunchAgent). | 🟠 Perte de données possible (rare) | S |
| **B8** | `persistence.ts:99` (`notes.filter(isPersistedNote)`) | Une note jugée invalide côté TS (ex. `bodyFormat` différent de `"markdown"`, accepté par Rust) est **silencieusement retirée** au chargement, puis le fichier est réécrit sans elle à la prochaine sauvegarde. Risque surtout lors de futures évolutions du format. | 🟡 Perte silencieuse potentielle | S |
| **B9** | `persistence.rs:178-185`, `lib.rs:121` | Fichier avec `schemaVersion` ≠ 1 (ex. après un retour à une ancienne version) : `setup` échoue → `expect` → crash au lancement sans message. Les données sont préservées (bon point), mais l'utilisateur n'a aucune explication. | 🟡 | S |
| **B10** | `stores/notes.ts:355-361` | Restaurer une note depuis la corbeille ne restaure ni l'épinglage ni l'archivage d'origine (mis à `false` au passage en corbeille). | 🟢 | S |
| **B11** | `stores/notes.ts:80,377` | « Aujourd'hui » et les temps relatifs (« À l'instant », « il y a 3 min ») ne se rafraîchissent jamais : app ouverte en continu (barre de menus), ils restent figés jusqu'au prochain re-rendu. | 🟢 | S |
| **B12** | `stores/notes.ts:132` | Historique de navigation (`history`) non borné. | 🟢 Fuite mémoire mineure | S |

## 2. Améliorations

### Performance
| ID | Fichier(s) | Description | Impact | Effort |
|---|---|---|---|---|
| **P1** | `editor/markdown.ts:83` (`noteText`), `NotesPanel.vue:104`, `stores/notes.ts:152`, `EditorPanel.vue:65` | Chaque frappe : la liste est recalculée, et `preview(note)` **re-parse le Markdown de chaque note** (TipTap `MarkdownManager.parse`), plus un parse par note pour la recherche, plus un pour le compteur de mots. Mesuré : ~1,2 ms/note courte → **~600 ms par frappe avec 500 notes**. Solution : cache `noteText` par `(id, body)` (WeakMap/Map), compteur de mots débouncé. | 🟠 Saisie qui rame dès quelques centaines de notes | S |
| **P2** | `persistence.rs` | Tout le fichier est réécrit à chaque sauvegarde (toutes les ~320 ms en frappe continue). OK jusqu'à quelques Mo ; à surveiller. | 🟢 | — |
| **P3** | `vite.config.ts` | Bundle unique de 665 kB. Sans enjeu réel pour une app de bureau locale. | 🟢 | — |

### UX
| ID | Description | Effort |
|---|---|---|
| **U1** | Indicateur de sauvegarde : état « Erreur — Réessayer » (lié à B5). | S |
| **U2** | Pas de « Vider la corbeille » ; la corbeille grossit indéfiniment. | S |
| **U3** | Les liens ne s'ouvrent jamais (`openOnClick: false`, plugin `opener` installé et autorisé mais inutilisé). ⌘+clic → ouverture via `@tauri-apps/plugin-opener`. | S |
| **U4** | Le chevron à côté du titre de liste (`NotesPanel.vue:57`) suggère un menu (tri ?) mais n'est pas cliquable. | S (retrait) / M (menu de tri) |
| **U5** | Notes vides créées par ⌘N puis abandonnées restent dans la liste (« Sans titre »). | S |
| **U6** | La recherche ignore le nom du tag ; pas de surlignage ; `Échap` ne ferme pas le champ de recherche. | S |
| **U7** | Libellés `⌘F` / `⌘N` codés en dur (`NotesPanel.vue:76,83`) alors que `shortcutLabel()` gère déjà mac/non-mac. | S |

### Accessibilité
| ID | Description | Effort |
|---|---|---|
| **A1** | Lignes de la liste de notes : pas d'`aria-current`/`aria-selected` sur la note active (`NotesPanel.vue:90`). | S |
| **A2** | `aria-label="Text formatting"` codé en anglais (`EditorPanel.vue`), non traduit. | S |
| **A3** | Popover « actions » a `role="menu"` mais pas de navigation flèches ni focus initial sur le premier item. | S |
| **A4** | Le contraste des couleurs de tags choisies librement (pastille + texte `--tag-color`) n'est pas contrôlé. | M |

### Sécurité
| ID | Fichier(s) | Description | Impact | Effort |
|---|---|---|---|---|
| **S1** | `tauri.conf.json` (`"csp": null`) | Aucune Content-Security-Policy. Le contenu est rendu par ProseMirror (pas de `v-html`, donc risque XSS faible), mais une CSP stricte (`default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`) est une défense en profondeur peu coûteuse. | 🟡 | S |
| **S2** | `editor/markdown.ts` | Un lien `[x](javascript:…)` collé en Markdown est conservé dans le modèle et réécrit dans le fichier ; TipTap neutralise le `href` au rendu (vérifié : `href=""`), donc pas exploitable aujourd'hui. À filtrer au parse via `normalizeLinkUrl` pour ne pas dépendre de ce comportement. | 🟢 | S |
| **S3** | `i18n.ts` (notes d'exemple) | Messages i18n contenant du HTML (warnings vue-i18n). Sans danger (contenu statique), disparaît avec le passage des exemples en Markdown (B2). | 🟢 | S |
| — | Secrets en dur | Aucun trouvé. Fichier de données créé en `0600` ✅. | — | — |

### Qualité de code / outillage
| ID | Description | Effort |
|---|---|---|
| **Q1** | `npm run typecheck` appelle `nuxi` (Nuxt) → cassé. Remplacer par `vue-tsc --noEmit`. Idem scripts reliquats `dev:debug` (`DEBUG=nuxt:*`) et `reinstall` (`.nuxt`, `bun.lockb`). | S |
| **Q2** | Pas de script `test` agrégé ; ajouter `"test": "node --test tests/*.test.mjs"` (+ `cargo test`). | S |
| **Q3** | Lint en échec (prettier sur 3 fichiers). | S |
| **Q4** | Test `styles-architecture` (2 sept.) contredit l'architecture actuelle (styles scoped dans les 11 composants, modifiés le 23 oct.). Soit le test est obsolète, soit il faut re-centraliser les styles. **Décision à prendre.** | S (adapter le test) / L (déplacer les styles) |
| **Q5** | `prepare: husky` + config `lint-staged` mais aucun dossier `.husky` → hooks inactifs. | S |
| **Q6** | `MarkdownEditor.format()` : noms de commandes hérités d'`execCommand` (`"insertText"` = liste de tâches, `"formatBlock"` = H2) — trompeur. | S |
| **Q7** | README = template Tauri ; aucune doc (emplacement des données, scripts, sauvegarde). | S |
| **Q8** | `.idea/`, `.DS_Store`, `src-tauri/target/` présents dans le dossier (ignorés par `.gitignore`, sans effet tant qu'il n'y a pas de git). | — |

## 3. Fonctionnalités manquantes à forte valeur

Sélection limitée à ce qui a du sens pour un bloc-notes de barre de menus, local, mono-utilisateur. Écartées volontairement : sync cloud, multi-tags par note (changement de format), liens entre notes (faible valeur ici), thème manuel (le mode sombre système existe déjà).

| ID | Fonctionnalité | Pourquoi | Effort |
|---|---|---|---|
| **F1** | **Annuler** après mise à la corbeille / suppression définitive / suppression de tag (toast « Annuler ») + confirmation pour la suppression définitive | Complète B1/B4 ; standard attendu | M |
| **F2** | **Sauvegardes automatiques** : copie tournante de `topnotes.json` (ex. 1/jour, 7 dernières) dans le dossier de l'app | Filet de sécurité contre tout bug futur ; un seul fichier = point unique de défaillance | S |
| **F3** | **Export** (Markdown : 1 fichier `.md` par note, ou JSON complet) et **import** JSON | Réversibilité, sauvegarde manuelle, migration | M |
| **F4** | **Raccourci global** (ex. ⌥⌘N / ⌥Space) pour afficher/masquer TopNotes depuis n'importe où | Cœur de l'usage d'une app de barre de menus ; nécessite `tauri-plugin-global-shortcut` (dépendance officielle Tauri) | M |
| **F5** | **Vider la corbeille** + purge auto des notes en corbeille depuis > 30 jours (option) | U2 | S |
| **F6** | **Tri** (date de modification / création / titre) via le chevron existant | U4 ; nécessite d'ajouter un réglage persistant (champ optionnel → rétrocompatible) | M |
| **F7** | Ouverture des liens (⌘+clic) | U3 | S |

---

## 4. Points de format de données

Aucune proposition ci-dessus n'exige de changer le format existant de manière incompatible. Les seuls ajouts envisagés sont des **champs optionnels** (`settings.sortOrder`, éventuellement `note.trashedAt` pour la purge auto et `note.wasPinned/wasArchived` pour B10), lus avec valeur par défaut côté TS **et** Rust (`#[serde(default)]`), sans bump de `schemaVersion`. Attention : Rust refuse aujourd'hui tout champ `Settings` manquant → tout ajout doit être `Option`/`default` des deux côtés.
