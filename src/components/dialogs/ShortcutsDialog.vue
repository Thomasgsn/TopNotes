<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import { editorShortcuts, navigationShortcuts, shortcutLabel } from "@/app/editor/shortcuts";
  import Dialog from "../base/Dialog.vue";

  const emit = defineEmits<{ close: [] }>();
  const { t } = useI18n();
  const mac = typeof navigator !== "undefined" && /Mac|iPad|iPhone/.test(navigator.platform);
  const nativeSelections = [
    { id: "selectionStart", key: "Shift-ArrowUp" },
    { id: "selectionEnd", key: "Shift-ArrowDown" },
  ];
  const groups = [
    { id: "navigation", shortcuts: navigationShortcuts },
    { id: "formatting", shortcuts: [...editorShortcuts, ...nativeSelections] },
  ];
</script>

<template>
  <Dialog
    :title="t('shortcuts.title')"
    :eyebrow="t('app.name')"
    :close-label="t('nav.close')"
    :action-label="t('settings.done')"
    @close="emit('close')"
  >
    <div class="shortcuts">
      <section v-for="group in groups" :key="group.id" class="shortcuts__group">
        <h3 class="shortcuts__heading">{{ t(`shortcuts.${group.id}`) }}</h3>
        <dl class="shortcuts__list">
          <div v-for="shortcut in group.shortcuts" :key="shortcut.key" class="shortcuts__row">
            <dt>{{ t(`shortcuts.${shortcut.id}`) }}</dt>
            <dd>
              <kbd class="shortcuts__keys">{{ shortcutLabel(shortcut.key, mac) }}</kbd>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </Dialog>
</template>

<style lang="scss" scoped>
  .shortcuts {
    max-height: 60dvh;
    padding: 16px 20px;
    overflow-y: auto;

    &__group + &__group {
      margin-top: 20px;
    }

    &__heading {
      margin: 0 0 8px;
      color: var(--accent);
      font-size: 12px;
    }

    &__list {
      margin: 0;
    }

    &__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 0;
      border-bottom: 1px solid var(--line);
      color: var(--text);
      font-size: 12px;
    }

    &__row dd {
      margin: 0;
      flex: 0 0 auto;
    }

    &__keys {
      padding: 3px 6px;
      border: 1px solid var(--line);
      border-radius: 5px;
      background: var(--hover);
      font-family: inherit;
      font-size: 11px;
      white-space: nowrap;
    }
  }
</style>
