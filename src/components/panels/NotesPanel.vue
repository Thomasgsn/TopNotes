<script setup lang="ts">
  import { ChevronDown, NotebookTabs, Pin, Search, SquarePen, Trash2, X } from "@lucide/vue";
  import { nextTick, ref } from "vue";
  import { useI18n } from "vue-i18n";
  import type { Note, NoteTag } from "@/app/types";
  import IconButton from "../base/IconButton.vue";

  const props = defineProps<{
    title: string;
    notes: Note[];
    selectedNoteId: string;
    query: string;
    formatTime: (timestamp: number) => string;
    preview: (note: Note) => string;
    tags: NoteTag[];
    tagName: (tag: NoteTag) => string;
    canEmptyTrash: boolean;
  }>();

  const emit = defineEmits<{
    selectNote: [note: Note];
    newNote: [];
    updateQuery: [query: string];
    emptyTrash: [];
  }>();

  const { t } = useI18n();
  const searchVisible = ref(false);
  const searchElement = ref<HTMLInputElement | null>(null);

  function tagLabel(id: string): string {
    const tag = props.tags.find((tag) => tag.id === id);
    return tag ? props.tagName(tag) : "";
  }

  function tagColor(id: string): string {
    return props.tags.find((tag) => tag.id === id)?.color ?? "#c96864";
  }

  function toggleSearch(): void {
    searchVisible.value = !searchVisible.value;
    if (searchVisible.value) nextTick(() => searchElement.value?.focus());
    else emit("updateQuery", "");
  }

  function focusSearch(): void {
    if (!searchVisible.value) toggleSearch();
    else searchElement.value?.focus();
  }

  defineExpose({ focusSearch });
</script>

<template>
  <section class="notes" :aria-label="t('app.notes')">
    <header class="notes__titlebar" data-tauri-drag-region>
      <div v-if="!searchVisible" class="notes__title">
        <span class="notes__title-text">{{ title }}</span>
        <ChevronDown class="notes__title-icon" :size="13" />
      </div>
      <div v-else class="notes__search">
        <Search class="notes__search-icon" :size="14" />
        <input
          ref="searchElement"
          class="notes__search-input"
          :value="query"
          type="search"
          :placeholder="t('nav.search')"
          :aria-label="t('nav.search')"
          @input="emit('updateQuery', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="notes__actions">
        <IconButton
          v-if="canEmptyTrash"
          :icon="Trash2"
          :size="16"
          :label="t('actions.emptyTrash')"
          :title="t('actions.emptyTrash')"
          variant="destructive"
          @click="emit('emptyTrash')"
        />
        <IconButton
          :icon="searchVisible ? X : Search"
          :size="searchVisible ? 16 : 17"
          :label="searchVisible ? t('nav.clearSearch') : t('nav.search')"
          :title="searchVisible ? t('nav.clearSearch') : `${t('nav.search')} (⌘F)`"
          @click="toggleSearch"
        />
        <IconButton
          :icon="SquarePen"
          :size="17"
          :label="t('nav.newNote')"
          :title="`${t('nav.newNote')} (⌘N)`"
          @click="emit('newNote')"
        />
      </div>
    </header>

    <div v-if="notes.length" class="notes__scroll">
      <button
        v-for="note in notes"
        :key="note.id"
        type="button"
        class="notes__row"
        :class="{ 'notes__row--selected': selectedNoteId === note.id }"
        @click="emit('selectNote', note)"
      >
        <span class="notes__heading">
          <strong class="notes__heading-title">{{ note.title || t("app.untitled") }}</strong>
          <time class="notes__heading-time" :datetime="new Date(note.updatedAt).toISOString()">{{
            formatTime(note.updatedAt)
          }}</time>
        </span>
        <span class="notes__preview">{{ preview(note) }}</span>
        <span class="notes__meta">
          <span v-if="note.tag" class="notes__tag" :style="{ '--tag-color': tagColor(note.tag) }">{{
            tagLabel(note.tag)
          }}</span>
          <span v-else></span>
          <Pin v-if="note.pinned" class="notes__pin" :size="12" fill="currentColor" />
        </span>
      </button>
    </div>

    <div v-else class="notes__empty">
      <Search v-if="query" :size="22" />
      <NotebookTabs v-else :size="22" />
      <strong class="notes__empty-title">{{
        query ? t("app.noSearchResults", { query }) : t("app.noNotes")
      }}</strong>
      <span v-if="!query" class="notes__empty-help">{{ t("app.noNotesHint") }}</span>
      <button v-if="!query" class="notes__empty-action" type="button" @click="emit('newNote')">
        {{ t("nav.newNote") }}
      </button>
    </div>
  </section>
</template>

<style lang="scss" scoped>
  .notes {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line);
    background: var(--list);

    &__titlebar {
      height: 54px;
      padding: 0 12px 0 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: 0 0 54px;
      gap: 8px;
      border-bottom: 1px solid var(--line);
      user-select: none;
      -webkit-app-region: drag;
    }

    &__title {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 5px;
      color: var(--text);
      font-size: 15px;
      font-weight: 680;
      letter-spacing: -0.01em;
    }

    &__title-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__title-icon,
    &__search-icon {
      flex: 0 0 auto;
      color: var(--muted);
    }

    &__search {
      min-width: 0;
      flex: 1;
      display: flex;
      align-items: center;
      gap: 7px;
      -webkit-app-region: no-drag;
    }

    &__search-input {
      min-width: 0;
      width: 100%;
      border: 0;
      outline: 0;
      color: var(--text);
      background: transparent;
      font-size: 12px;

      &::-webkit-search-cancel-button {
        display: none;
      }
    }

    &__actions {
      display: flex;
      align-items: center;
      gap: 2px;
      -webkit-app-region: no-drag;
    }

    &__scroll {
      min-height: 0;
      flex: 1;
      padding: 8px 8px 16px;
      overflow: hidden auto;
    }

    &__row {
      position: relative;
      width: 100%;
      min-height: 112px;
      padding: 14px 14px 12px 16px;
      display: block;
      border-bottom: 1px solid var(--line);
      color: var(--text);
      background: transparent;
      cursor: pointer;
      text-align: left;
      transition: background 130ms ease-out;

      &:hover {
        background: var(--hover);
      }

      &--selected {
        border-bottom-color: transparent;
        border-radius: 8px;
        background: var(--accent-soft);

        &::before {
          position: absolute;
          inset: 0 auto 0 0;
          width: 4px;
          border-radius: 8px 0 0 8px;
          background: var(--accent);
          content: "";
        }
      }
    }

    &__heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    &__heading-title {
      min-width: 0;
      overflow: hidden;
      color: var(--text);
      font-size: 13px;
      font-weight: 680;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__heading-time {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 9px;
      font-weight: 500;
    }

    &__preview {
      height: 38px;
      margin-top: 6px;
      overflow: hidden;
      color: var(--muted);
      display: -webkit-box;
      font-size: 11px;
      line-height: 19px;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    &__meta {
      min-height: 18px;
      margin-top: 7px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    &__tag {
      padding: 2px 7px;
      border-radius: 999px;
      color: var(--tag-color);
      background: color-mix(in srgb, var(--tag-color) 12%, transparent);
      font-size: 9px;
      font-weight: 650;
    }

    &__pin {
      color: var(--accent);
    }

    &__empty {
      flex: 1;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--muted);
      text-align: center;
    }

    &__empty-title {
      color: var(--text);
      font-size: 13px;
    }

    &__empty-help {
      max-width: 210px;
      font-size: 11px;
      line-height: 1.5;
    }

    &__empty-action {
      margin-top: 5px;
      padding: 7px 11px;
      border-radius: 7px;
      color: #fff;
      background: var(--accent);
      cursor: pointer;
      font-size: 11px;
      font-weight: 650;
    }
  }
</style>
