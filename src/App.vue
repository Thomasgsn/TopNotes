<script setup lang="ts">
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { ref, watch } from "vue";
  import { useI18n } from "vue-i18n";
  import SettingsDialog from "./components/dialogs/SettingsDialog.vue";
  import TagsDialog from "./components/dialogs/TagsDialog.vue";
  import ShortcutsDialog from "./components/dialogs/ShortcutsDialog.vue";
  import ConfirmDialog from "./components/dialogs/ConfirmDialog.vue";
  import EditorPanel from "./components/panels/EditorPanel.vue";
  import NavigationPanel from "./components/panels/NavigationPanel.vue";
  import NotesPanel from "./components/panels/NotesPanel.vue";
  import { appPersistence } from "./persistence";
  import type { PersistedAppData } from "./persistence";
  import { useNotesStore } from "./stores/notes";
  import { useNoteWindow } from "./stores/noteWindow";
  import { useSettingsStore } from "./stores/settings";

  const props = defineProps<{ initialData: PersistedAppData }>();
  const { t, locale } = useI18n();
  const notesPanel = ref<InstanceType<typeof NotesPanel> | null>(null);
  const shortcutsVisible = ref(false);
  const { detached, busy: noteWindowBusy, detach, attach } = useNoteWindow();

  const notesStore = useNotesStore({
    initialNotes: props.initialData.notes,
    initialTags: props.initialData.tags,
    locale,
    persistence: appPersistence,
    translate: (key) => String(t(key)),
    focusSearch: () => void attach().then(() => notesPanel.value?.focusSearch()),
    focusTitle: () => document.querySelector<HTMLInputElement>(".editor__title")?.focus(),
    selectionLocked: detached,
    openSettings: () => settingsStore.openSettings(),
    openShortcuts: () => {
      shortcutsVisible.value = true;
    },
  });

  const settingsStore = useSettingsStore({
    initialSettings: props.initialData.settings,
    locale,
    persistence: appPersistence,
  });

  const {
    activeFilter,
    activeFilterTitle,
    cancelDelete,
    cancelQuit,
    confirmDelete,
    convertLegacyBody,
    forceQuit,
    formatRelativeTime,
    newNote,
    noteCounts,
    notePreview,
    pendingDeletion,
    quitBlocked,
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
    settingsVisible,
    toggleAlwaysOnTop,
    toggleAutostart,
  } = settingsStore;

  watch(selectedNoteId, () => {
    if (detached.value) void attach();
  });

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
      @select-note="selectNote"
      @new-note="newNote"
      @update-query="setSearchQuery"
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
      @close="closeSettings"
      @set-locale="setLocale"
      @toggle-autostart="toggleAutostart"
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
      v-if="quitBlocked"
      :title="t('confirm.quitUnsavedTitle')"
      :message="t('confirm.quitUnsavedMessage')"
      :confirm-label="t('confirm.quitUnsaved')"
      @confirm="forceQuit"
      @cancel="cancelQuit"
    />
  </main>
</template>
