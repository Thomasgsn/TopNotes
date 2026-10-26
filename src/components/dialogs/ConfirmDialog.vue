<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import Dialog from "../base/Dialog.vue";

  defineProps<{
    title: string;
    message: string;
    confirmLabel: string;
  }>();
  const emit = defineEmits<{ confirm: []; cancel: [] }>();
  const { t } = useI18n();
</script>

<template>
  <Dialog
    :title="title"
    :eyebrow="t('app.name')"
    :close-label="t('nav.close')"
    :action-label="t('confirm.cancel')"
    @close="emit('cancel')"
  >
    <p class="confirm__message">{{ message }}</p>
    <template #footer>
      <div class="confirm__actions">
        <button class="confirm__cancel" type="button" autofocus @click="emit('cancel')">
          {{ t("confirm.cancel") }}
        </button>
        <button class="confirm__confirm" type="button" @click="emit('confirm')">
          {{ confirmLabel }}
        </button>
      </div>
    </template>
  </Dialog>
</template>

<style lang="scss" scoped>
  .confirm {
    &__message {
      padding: 18px 20px 0;
      color: var(--text);
      font-size: 13px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    &__actions {
      display: flex;
      gap: 8px;
    }

    &__cancel,
    &__confirm {
      padding: 8px 12px;
      border-radius: 7px;
      font-size: 12px;
      cursor: pointer;
    }

    &__cancel {
      color: var(--text);
      background: var(--hover);
    }

    &__confirm {
      color: #fff;
      background: #b34f4b;
    }
  }
</style>
