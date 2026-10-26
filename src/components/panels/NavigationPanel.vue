<script setup lang="ts">
  import {
    Archive,
    CalendarDays,
    Check,
    NotebookTabs,
    Pin,
    Pencil,
    Plus,
    SlidersHorizontal,
    Trash2,
  } from "@lucide/vue";
  import { useI18n } from "vue-i18n";
  import type { FilterId, NoteTag, TagId } from "@/app/types";
  import IconButton from "../base/IconButton.vue";

  defineProps<{
    saved: boolean;
    activeFilter: FilterId;
    counts: Record<"all" | "today" | "pinned" | "archive" | "trash", number>;
    tagCounts: Record<TagId, number>;
    tags: NoteTag[];
    tagName: (tag: NoteTag) => string;
  }>();

  const emit = defineEmits<{
    selectFilter: [filter: FilterId];
    openSettings: [];
    manageTags: [];
  }>();

  const { t } = useI18n();

  function handleNavigationKeydown(event: KeyboardEvent): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (!(event.currentTarget instanceof HTMLElement) || !(event.target instanceof Element)) return;

    const currentItem = event.target.closest<HTMLButtonElement>(".navigation__item");
    if (!currentItem) return;

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(".navigation__item:not(:disabled)"),
    );
    const currentIndex = items.indexOf(currentItem);
    if (currentIndex < 0) return;

    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? Math.min(currentIndex + 1, items.length - 1)
            : Math.max(currentIndex - 1, 0);
    const nextItem = items[nextIndex];
    const filter = nextItem?.dataset.filter as FilterId | undefined;
    if (!nextItem || !filter) return;

    event.preventDefault();
    nextItem.focus({ preventScroll: true });
    nextItem.scrollIntoView({ block: "nearest" });
    emit("selectFilter", filter);
  }
</script>

<template>
  <aside class="navigation" :aria-label="t('app.library')">
    <header class="navigation__titlebar" data-tauri-drag-region>
      <IconButton
        :icon="SlidersHorizontal"
        :size="17"
        :stroke-width="1.8"
        :label="t('nav.settings')"
        variant="dark"
        @click="emit('openSettings')"
      />
    </header>

    <div class="navigation__scroll" @keydown="handleNavigationKeydown">
      <section class="navigation__section">
        <h2 class="navigation__section-title">{{ t("app.library") }}</h2>
        <button
          class="navigation__item"
          :class="{ 'navigation__item--selected': activeFilter === 'all' }"
          data-filter="all"
          :aria-current="activeFilter === 'all' ? 'page' : undefined"
          @click="emit('selectFilter', 'all')"
        >
          <NotebookTabs :size="17" />
          <span class="navigation__item-label">{{ t("app.allNotes") }}</span>
          <small class="navigation__item-count">{{ counts.all }}</small>
        </button>
        <button
          class="navigation__item"
          :class="{ 'navigation__item--selected': activeFilter === 'today' }"
          data-filter="today"
          :aria-current="activeFilter === 'today' ? 'page' : undefined"
          @click="emit('selectFilter', 'today')"
        >
          <CalendarDays :size="17" />
          <span class="navigation__item-label">{{ t("app.today") }}</span>
          <small class="navigation__item-count">{{ counts.today }}</small>
        </button>
        <button
          class="navigation__item"
          :class="{ 'navigation__item--selected': activeFilter === 'pinned' }"
          data-filter="pinned"
          :aria-current="activeFilter === 'pinned' ? 'page' : undefined"
          @click="emit('selectFilter', 'pinned')"
        >
          <Pin :size="17" />
          <span class="navigation__item-label">{{ t("app.pinned") }}</span>
          <small class="navigation__item-count">{{ counts.pinned }}</small>
        </button>
        <button
          class="navigation__item"
          :class="{ 'navigation__item--selected': activeFilter === 'archive' }"
          data-filter="archive"
          :aria-current="activeFilter === 'archive' ? 'page' : undefined"
          @click="emit('selectFilter', 'archive')"
        >
          <Archive :size="17" />
          <span class="navigation__item-label">{{ t("app.archive") }}</span>
          <small v-if="counts.archive" class="navigation__item-count">{{ counts.archive }}</small>
        </button>
        <button
          class="navigation__item"
          :class="{ 'navigation__item--selected': activeFilter === 'trash' }"
          data-filter="trash"
          :aria-current="activeFilter === 'trash' ? 'page' : undefined"
          @click="emit('selectFilter', 'trash')"
        >
          <Trash2 :size="17" />
          <span class="navigation__item-label">{{ t("app.trash") }}</span>
          <small v-if="counts.trash" class="navigation__item-count">{{ counts.trash }}</small>
        </button>
      </section>

      <section class="navigation__section">
        <div class="navigation__section-heading">
          <h2 class="navigation__section-title">{{ t("app.tags") }}</h2>
          <IconButton
            :icon="tags.length ? Pencil : Plus"
            :size="14"
            :label="t('tagManager.title')"
            variant="dark"
            @click="emit('manageTags')"
          />
        </div>
        <button
          v-for="tag in tags"
          :key="tag.id"
          class="navigation__item"
          :class="{ 'navigation__item--selected': activeFilter === `tag:${tag.id}` }"
          :data-filter="`tag:${tag.id}`"
          :aria-current="activeFilter === `tag:${tag.id}` ? 'page' : undefined"
          @click="emit('selectFilter', `tag:${tag.id}`)"
        >
          <i class="navigation__tag-dot" :style="{ background: tag.color }"></i>
          <span class="navigation__item-label">{{ tagName(tag) }}</span>
          <small class="navigation__item-count">{{ tagCounts[tag.id] ?? 0 }}</small>
        </button>
        <button class="navigation__manage-tags" type="button" @click="emit('manageTags')">
          {{ t("tagManager.title") }}
        </button>
      </section>
    </div>

    <!-- TODO: may be update  in future version if we are able to connect a db -->
    <footer :class="[`navigation__footer`, { [`navigation__footer--saved`]: saved }]">
      <Check v-if="saved" :size="12" />
      <span class="navigation__footer-label">
        {{ saved ? t("app.saved") : t("app.saving") }}
      </span>
    </footer>
  </aside>
</template>

<style lang="scss" scoped>
  .navigation {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    color: var(--nav-text);
    background: var(--nav);

    &__titlebar {
      height: 54px;
      padding: 0 14px 0 84px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex: 0 0 54px;
      user-select: none;
      -webkit-app-region: drag;
    }

    &__scroll {
      flex: 1;
      padding: 8px 10px 16px;
      overflow: hidden auto;
    }

    &__section {
      margin-bottom: 20px;
    }

    &__section-title {
      margin: 0;
      padding: 0 10px 7px;
      color: #898b8b;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    &__section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    &__manage-tags {
      padding: 8px 10px;
      color: var(--nav-muted);
      background: transparent;
      font-size: 11px;
      cursor: pointer;
    }

    &__item {
      width: 100%;
      min-height: 34px;
      padding: 0 10px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-radius: 7px;
      color: var(--nav-muted);
      background: transparent;
      cursor: pointer;
      text-align: left;
      transition:
        color 140ms ease-out,
        background 140ms ease-out;

      &:hover {
        color: var(--nav-text);
        background: rgb(255 255 255 / 6%);
      }

      &--selected {
        color: #fff;
        background: var(--nav-selected);
      }
    }

    &__item-label {
      min-width: 0;
      flex: 1;
      overflow: hidden;
      font-size: 13px;
      font-weight: 560;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__item-count {
      color: #858787;
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }

    &__tag-dot {
      width: 8px;
      height: 8px;
      margin-left: 5px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: #7f909e;

      &--coral {
        background: var(--accent);
      }

      &--green {
        background: #78947b;
      }

      &--blue {
        background: #718aa1;
      }
    }

    &__footer {
      height: 42px;
      padding: 0 18px;
      display: flex;
      align-items: center;
      gap: 7px;
      border-top: 1px solid rgb(255 255 255 / 7%);
      font-size: 10px;
      color: var(--muted);
      font-weight: 650;

      &--saving {
        color: var(--saved);
      }
    }

    &__footer-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
</style>
