<script setup lang="ts">
  import { ref, useId } from "vue";
  import { useI18n } from "vue-i18n";
  import { normalizeLinkUrl } from "@/app/editor/links";
  import type { LinkDraft } from "@/app/editor/links";
  import Dialog from "../base/Dialog.vue";

  const props = defineProps<{ draft: LinkDraft }>();
  const emit = defineEmits<{ close: []; save: [url: string, label: string]; remove: [] }>();
  const { t } = useI18n();
  const formId = useId();
  const url = ref(props.draft.href);
  const label = ref(props.draft.label);
  const invalid = ref(false);

  function save(): void {
    const href = normalizeLinkUrl(url.value);
    invalid.value = !href;
    if (href) emit("save", href, label.value);
  }
</script>

<template>
  <Dialog
    :title="t(draft.href ? 'linkEditor.edit' : 'linkEditor.title')"
    :eyebrow="t('app.name')"
    :close-label="t('nav.close')"
    :action-label="t('linkEditor.save')"
    @close="emit('close')"
  >
    <form :id="formId" class="link-editor" @submit.prevent="save">
      <label class="link-editor__field">
        <span>{{ t("linkEditor.label") }}</span>
        <input
          v-model="label"
          class="link-editor__input"
          type="text"
          :placeholder="t('linkEditor.labelPlaceholder')"
        />
      </label>
      <label class="link-editor__field">
        <span>{{ t("linkEditor.url") }}</span>
        <input
          v-model="url"
          class="link-editor__input"
          type="text"
          inputmode="url"
          placeholder="https://example.com"
          autofocus
          required
          :aria-invalid="invalid"
          :aria-describedby="invalid ? `${formId}-error` : undefined"
          @input="invalid = false"
        />
      </label>
      <p v-if="invalid" :id="`${formId}-error`" class="link-editor__error" role="alert">
        {{ t("linkEditor.invalid") }}
      </p>
    </form>
    <template #footer>
      <div class="link-editor__actions">
        <button v-if="draft.href" class="link-editor__remove" type="button" @click="emit('remove')">
          {{ t("linkEditor.remove") }}
        </button>
        <button class="link-editor__cancel" type="button" @click="emit('close')">
          {{ t("linkEditor.cancel") }}
        </button>
        <button class="link-editor__save" type="submit" :form="formId">
          {{ t("linkEditor.save") }}
        </button>
      </div>
    </template>
  </Dialog>
</template>

<style lang="scss" scoped>
  .link-editor {
    padding: 18px 20px 0;

    &__field {
      margin-bottom: 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      color: var(--text);
      font-size: 12px;
    }

    &__input {
      width: 100%;
      padding: 9px 10px;
      border: 1px solid var(--line);
      border-radius: 7px;
      color: var(--text);
      background: var(--paper);

      &:focus {
        border-color: var(--accent);
      }
    }

    &__error {
      color: #b34f4b;
      font-size: 12px;
    }

    &__actions {
      width: 100%;
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    &__save,
    &__cancel,
    &__remove {
      padding: 8px 12px;
      border-radius: 7px;
      font-size: 12px;
      cursor: pointer;
    }

    &__save {
      color: #fff;
      background: var(--accent);
    }

    &__cancel {
      color: var(--text);
      background: var(--hover);
    }

    &__remove {
      margin-right: auto;
      color: #b34f4b;
    }
  }
</style>
