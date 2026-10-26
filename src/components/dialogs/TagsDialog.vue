<script setup lang="ts">
  import { Plus, Trash2 } from "@lucide/vue";
  import { ref } from "vue";
  import { useI18n } from "vue-i18n";
  import type { TagError } from "@/app/tags";
  import type { NoteTag } from "@/app/types";
  import Dialog from "../base/Dialog.vue";
  import IconButton from "../base/IconButton.vue";

  const props = defineProps<{
    tags: NoteTag[];
    tagName: (tag: NoteTag) => string;
    addTag: (name: string, color: string) => TagError | null;
    editTag: (id: string, name: string, color: string) => TagError | null;
  }>();
  const emit = defineEmits<{ close: []; delete: [id: string] }>();
  const { t } = useI18n();
  const newName = ref("");
  const newColor = ref("#c96864");
  const error = ref<TagError | null>(null);

  function add(): void {
    error.value = props.addTag(newName.value, newColor.value);
    if (!error.value) newName.value = "";
  }

  function rename(tag: NoteTag, event: Event): void {
    const input = event.target as HTMLInputElement;
    error.value = props.editTag(tag.id, input.value, tag.color);
    input.value = props.tagName(tag);
  }

  function recolor(tag: NoteTag, event: Event): void {
    error.value = props.editTag(
      tag.id,
      props.tagName(tag),
      (event.target as HTMLInputElement).value,
    );
  }
</script>

<template>
  <Dialog
    :title="t('tagManager.title')"
    :eyebrow="t('app.library')"
    :close-label="t('nav.close')"
    :action-label="t('settings.done')"
    @close="emit('close')"
  >
    <div class="tag-manager">
      <p class="tag-manager__help">{{ t("tagManager.help") }}</p>
      <div class="tag-manager__list">
        <div v-for="tag in tags" :key="tag.id" class="tag-manager__row">
          <input
            class="tag-manager__color"
            type="color"
            :value="tag.color"
            :aria-label="t('tagManager.color')"
            @input="recolor(tag, $event)"
          />
          <input
            class="tag-manager__name"
            type="text"
            maxlength="60"
            :value="tagName(tag)"
            :aria-label="t('tagManager.name')"
            @change="rename(tag, $event)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <IconButton
            :icon="Trash2"
            :size="15"
            :label="t('tagManager.delete', { name: tagName(tag) })"
            variant="destructive"
            @click="emit('delete', tag.id)"
          />
        </div>
      </div>
      <form class="tag-manager__row" @submit.prevent="add">
        <input
          v-model="newColor"
          class="tag-manager__color"
          type="color"
          :aria-label="t('tagManager.color')"
        />
        <input
          v-model="newName"
          class="tag-manager__name"
          type="text"
          maxlength="60"
          :placeholder="t('tagManager.newName')"
          :aria-label="t('tagManager.newName')"
          required
        />
        <button class="tag-manager__add" type="submit" :aria-label="t('tagManager.add')">
          <Plus :size="16" />
        </button>
      </form>
      <p v-if="error" class="tag-manager__error" role="alert">{{ t(`tagManager.${error}`) }}</p>
    </div>
  </Dialog>
</template>

<style lang="scss" scoped>
  .tag-manager {
    padding: 16px 20px 0;

    &__help {
      margin: 0 0 14px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    &__list {
      max-height: 40vh;
      margin-bottom: 12px;
      overflow-y: auto;
    }

    &__row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }

    &__color {
      appearance: auto;
      width: 30px;
      height: 30px;
      padding: 2px;
      flex: 0 0 auto;
      border: 0;
      background: transparent;
      cursor: pointer;
    }

    &__name {
      min-width: 0;
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 7px;
      color: var(--text);
      background: var(--paper);
      font-size: 13px;
    }

    &__add {
      width: 30px;
      height: 30px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      border-radius: 7px;
      color: #fff;
      background: var(--accent);
      cursor: pointer;
    }

    &__error {
      color: #b34f4b;
      font-size: 12px;
    }
  }
</style>
