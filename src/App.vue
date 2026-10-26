<script setup lang="ts">
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { ref, watch } from "vue";
  import { useI18n } from "vue-i18n";
  import SettingsDialog from "./components/dialogs/SettingsDialog.vue";
  import TagsDialog from "./components/dialogs/TagsDialog.vue";
  import ShortcutsDialog from "./components/dialogs/ShortcutsDialog.vue";
  import ConfirmDialog from "./components/dialogs/ConfirmDialog.vue";
  import UndoToast from "./components/base/UndoToast.vue";
  import EditorPanel from "./components/panels/EditorPanel.vue";
  import NavigationPanel from "./components/panels/NavigationPanel.vue";
  import NotesPanel from "./components/panels/NotesPanel.vue";
  import { appPersistence } from "./persistence";
  import {
    buildJsonExport,
    buildMarkdownExport,
    exportFolderName,
    parseJsonImport,
    saveExport,
  } from "./exchange";
  import type { PersistedAppData } from "./persistence";
  import { TRASH_RETENTION_DAYS, useNotesStore } from "./stores/notes";
  import { useNoteWindow } from "./stores/noteWindow";
  import { useSettingsStore } from "./stores/settings";

  const props = defineProps<{ initialData: PersistedAppData }>();
  const { t, locale } = useI18n();
  const notesPanel = ref<InstanceType<typeof NotesPanel> | null>(null);
  const shortcutsVisible = ref(false);
  const { detached, busy: noteWindowBusy, detach, attach } = useNoteWindow();

  const settingsStore = useSettingsStore({
    initialSettings: props.initialData.settings,
    locale,
    persistence: appPersistence,
  });

  const notesStore = useNotesStore({
    initialNotes: props.initialData.notes,
    initialTags: props.initialData.tags,
    locale,
    persistence: appPersistence,
    translate: (key) => String(t(key)),
    focusSearch: () => void attach().then(() => notesPanel.value?.focusSearch()),
    focusTitle: () => document.querySelector<HTMLInputElement>(".editor__title")?.focus(),
    selectionLocked: detached,
    sortOrder: settingsStore.sortOrder,
    openSettings: () => settingsStore.openSettings(),
    openShortcuts: () => {
      shortcutsVisible.value = true;
    },
  });

  const {
    activeFilter,
    activeFilterTitle,
    cancelDelete,
    cancelEmptyTrash,
    cancelQuit,
    confirmDelete,
    confirmEmptyTrash,
    convertLegacyBody,
    emptyTrashPending,
    forceQuit,
    formatRelativeTime,
    importNotes,
    notes,
    newNote,
    noteCounts,
    notePreview,
    pendingDeletion,
    quitBlocked,
    requestEmptyTrash,
    restoreNote,
    retrySave,
    saved,
    saveError,
    searchQuery,
    selectFilter,
    selectedNote,
    selectedNoteId,
    selectNote,
    setSearchQuery,
    tagCounts,
    tags,
    tagName,
    tagsVisible,
    openTags,
    closeTags,
    addTag,
    editTag,
    requestDeleteTag,
    confirmDeleteTag,
    cancelDeleteTag,
    pendingTagDeletion,
    toggleArchive,
    togglePin,
    undo,
    undoable,
    trashOrDeleteNote,
    updateBody,
    updateTag,
    updateTitle,
    visibleNotes,
  } = notesStore;

  const {
    alwaysOnTop,
    alwaysOnTopBusy,
    autostartBusy,
    autostartEnabled,
    closeSettings,
    nativeRuntime,
    openSettings,
    setLocale,
    setSortOrder,
    sortOrder,
    settingsVisible,
    toggleAlwaysOnTop,
    toggleAutostart,
  } = settingsStore;

  watch(selectedNoteId, () => {
    if (detached.value) void attach();
  });

  const exchangeStatus = ref("");
  const exchangeBusy = ref(false);

  async function exportNotes(format: "json" | "markdown"): Promise<void> {
    exchangeBusy.value = true;
    try {
      const translate = (key: string) => String(t(key));
      const files =
        format === "json"
          ? [buildJsonExport(notes.value, tags.value)]
          : buildMarkdownExport(notes.value, tags.value, translate);
      const folder = await saveExport(exportFolderName(), files);
      exchangeStatus.value = folder ? t("exchange.exported", { folder }) : t("exchange.downloaded");
    } catch (error) {
      console.error("TopNotes could not export the notes.", error);
      exchangeStatus.value = t("exchange.exportFailed");
    } finally {
      exchangeBusy.value = false;
    }
  }

  async function importFile(file: File): Promise<void> {
    exchangeBusy.value = true;
    try {
      const data = parseJsonImport(await file.text());
      const { added } = importNotes(data.notes, data.tags);
      exchangeStatus.value = t("exchange.imported", { count: added }, added);
    } catch (error) {
      console.error("TopNotes could not import the file.", error);
      exchangeStatus.value = t("exchange.importFailed");
    } finally {
      exchangeBusy.value = false;
    }
  }

  // Quitting from the tray can fail while the window is hidden: bring it back so the
  // unsaved-changes prompt is actually seen.
  watch(quitBlocked, async (blocked) => {
    if (!blocked || !isTauri()) return;
    const appWindow = getCurrentWindow();
    await appWindow.show().catch(() => undefined);
    await appWindow.setFocus().catch(() => undefined);
  });
</script>

<template>
  <main class="app" :class="{ 'app--detached': detached }" :aria-label="t('app.name')">
    <NavigationPanel
      v-if="!detached"
      :saved="saved"
      :save-error="saveError"
      :active-filter="activeFilter"
      :counts="noteCounts"
      :tag-counts="tagCounts"
      :tags="tags"
      :tag-name="tagName"
      @select-filter="selectFilter"
      @open-settings="openSettings"
      @manage-tags="openTags"
      @retry-save="retrySave"
    />
    <NotesPanel
      v-if="!detached"
      ref="notesPanel"
      :title="activeFilterTitle"
      :notes="visibleNotes"
      :selected-note-id="selectedNoteId"
      :query="searchQuery"
      :format-time="formatRelativeTime"
      :preview="notePreview"
      :tags="tags"
      :tag-name="tagName"
      :can-empty-trash="activeFilter === 'trash' && noteCounts.trash > 0"
      :sort-order="sortOrder"
      :hint="
        activeFilter === 'trash' ? t('app.trashRetention', { days: TRASH_RETENTION_DAYS }) : ''
      "
      @select-note="selectNote"
      @new-note="newNote"
      @update-query="setSearchQuery"
      @empty-trash="requestEmptyTrash"
      @set-sort-order="setSortOrder"
    />
    <EditorPanel
      :note="selectedNote"
      :always-on-top="alwaysOnTop"
      :always-on-top-busy="alwaysOnTopBusy"
      :detached="detached"
      :note-window-busy="noteWindowBusy"
      :tags="tags"
      :tag-name="tagName"
      @new-note="newNote"
      @update-title="updateTitle"
      @update-body="updateBody"
      @convert-body="convertLegacyBody"
      @update-tag="updateTag"
      @toggle-pin="togglePin"
      @toggle-archive="toggleArchive"
      @restore="restoreNote"
      @trash-or-delete="trashOrDeleteNote"
      @toggle-always-on-top="toggleAlwaysOnTop"
      @detach="detach"
      @attach="attach"
      @open-shortcuts="shortcutsVisible = true"
    />
    <SettingsDialog
      v-if="settingsVisible"
      :locale="locale"
      :native-runtime="nativeRuntime"
      :autostart-enabled="autostartEnabled"
      :autostart-busy="autostartBusy"
      :exchange-status="exchangeStatus"
      :exchange-busy="exchangeBusy"
      @close="closeSettings"
      @set-locale="setLocale"
      @toggle-autostart="toggleAutostart"
      @export-notes="exportNotes"
      @import-file="importFile"
    />
    <TagsDialog
      v-if="tagsVisible"
      :tags="tags"
      :tag-name="tagName"
      :add-tag="addTag"
      :edit-tag="editTag"
      @delete="requestDeleteTag"
      @close="closeTags"
    />
    <ShortcutsDialog v-if="shortcutsVisible" @close="shortcutsVisible = false" />
    <UndoToast
      v-if="undoable"
      :message="t(undoable.message, undoable.params, Number(undoable.params.count ?? 1))"
      :action-label="t('undo.action')"
      @undo="undo"
    />
    <ConfirmDialog
      v-if="pendingDeletion"
      :title="t('confirm.deleteNoteTitle')"
      :message="
        t('confirm.deleteNoteMessage', { title: pendingDeletion.title || t('app.untitled') })
      "
      :confirm-label="t('confirm.delete')"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
    <ConfirmDialog
      v-if="pendingTagDeletion"
      :title="t('confirm.deleteTagTitle')"
      :message="
        t(
          'confirm.deleteTagMessage',
          { name: tagName(pendingTagDeletion.tag), count: pendingTagDeletion.noteCount },
          pendingTagDeletion.noteCount,
        )
      "
      :confirm-label="t('confirm.delete')"
      @confirm="confirmDeleteTag"
      @cancel="cancelDeleteTag"
    />
    <ConfirmDialog
      v-if="emptyTrashPending"
      :title="t('confirm.emptyTrashTitle')"
      :message="t('confirm.emptyTrashMessage', { count: noteCounts.trash }, noteCounts.trash)"
      :confirm-label="t('actions.emptyTrash')"
      @confirm="confirmEmptyTrash"
      @cancel="cancelEmptyTrash"
    />
    <ConfirmDialog
      v-if="quitBlocked"
      :title="t('confirm.quitUnsavedTitle')"
      :message="t('confirm.quitUnsavedMessage')"
      :confirm-label="t('confirm.quitUnsaved')"
      @confirm="forceQuit"
      @cancel="cancelQuit"
    />
  </main>
</template>
