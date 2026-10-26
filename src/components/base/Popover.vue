<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";

  type PopoverVariant = "info" | "actions";

  const props = defineProps<{
    open: boolean;
    variant: PopoverVariant;
    label: string;
  }>();

  const emit = defineEmits<{
    close: [];
  }>();

  defineSlots<{
    trigger(props: { panelId: string }): unknown;
    default(): unknown;
  }>();

  const rootElement = ref<HTMLElement | null>(null);
  const panelId = useId();

  function closeOnOutsidePointer(event: PointerEvent): void {
    if (props.open && !rootElement.value?.contains(event.target as Node)) emit("close");
  }

  function closeOnEscape(event: KeyboardEvent): void {
    if (!props.open || event.key !== "Escape") return;
    const focusInside = rootElement.value?.contains(document.activeElement);
    emit("close");
    // Give focus back to the trigger rather than losing it to the document.
    if (focusInside) rootElement.value?.querySelector<HTMLElement>("button")?.focus();
  }

  function menuItems(): HTMLElement[] {
    return Array.from(
      rootElement.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
  }

  // Menus follow the WAI-ARIA pattern: first item focused, arrows to move.
  function navigateMenu(event: KeyboardEvent): void {
    if (props.variant !== "actions") return;
    const items = menuItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next: Record<string, number> = {
      ArrowDown: (current + 1) % items.length,
      ArrowUp: (current - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    items[next[event.key]]?.focus();
  }

  watch(
    () => props.open,
    (open) => {
      if (open && props.variant === "actions") void nextTick(() => menuItems()[0]?.focus());
    },
  );

  onMounted(() => {
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", closeOnOutsidePointer);
    document.removeEventListener("keydown", closeOnEscape);
  });
</script>

<template>
  <div ref="rootElement" class="popover">
    <slot name="trigger" :panel-id="panelId" />
    <div
      v-if="open"
      :id="panelId"
      :class="[`popover__panel`, `popover__panel--${variant}`]"
      :role="variant === 'actions' ? 'menu' : 'dialog'"
      :aria-label="label"
      @click.stop
      @keydown="navigateMenu"
    >
      <slot />
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .popover {
    position: relative;

    &__panel {
      position: absolute;
      top: 36px;
      right: 0;
      z-index: 30;
      border: 1px solid rgb(30 31 32 / 10%);
      border-radius: 10px;
      color: var(--text);
      background: rgb(255 255 255 / 98%);
      box-shadow:
        0 12px 36px rgb(20 22 24 / 16%),
        0 2px 7px rgb(20 22 24 / 8%);
      -webkit-app-region: no-drag;

      &--info {
        width: 270px;
        padding: 13px;
      }

      &--actions {
        width: 205px;
        padding: 5px;
      }
    }

    :deep(.popover__heading) {
      margin-bottom: 7px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
    }

    :deep(.popover__close) {
      width: 24px;
      height: 24px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      color: var(--muted);
      background: transparent;
      cursor: pointer;

      &:hover {
        background: var(--hover);
      }
    }

    :deep(.popover__details) {
      margin: 0;
    }

    :deep(.popover__row) {
      padding: 8px 0;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      border-top: 1px solid var(--line);
      font-size: 10px;

      dt {
        color: var(--muted);
      }

      dd {
        margin: 0;
        color: var(--text);
        text-align: right;
      }
    }

    :deep(.popover__row--tag) {
      align-items: center;
    }

    :deep(.popover__select) {
      max-width: 120px;
      padding: 4px 22px 4px 7px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--text);
      background: var(--list);
      font-size: 10px;
    }

    :deep(.popover__action) {
      width: 100%;
      min-height: 31px;
      padding: 0 9px;
      display: flex;
      align-items: center;
      gap: 9px;
      border-radius: 6px;
      color: var(--text);
      background: transparent;
      cursor: pointer;
      text-align: left;
      font-size: 11px;

      &:hover {
        color: #fff;
        background: var(--accent);
      }
    }

    :deep(.popover__action--destructive) {
      color: #b34f4b;

      &:hover {
        color: #fff;
        background: #b75c52;
      }
    }

    :deep(.popover__divider) {
      height: 1px;
      margin: 4px 6px;
      background: var(--line);
    }
  }

  @media (prefers-color-scheme: dark) {
    .popover {
      &__panel {
        background: rgb(45 47 48 / 99%);
      }

      :deep(.popover__select) {
        background: #363839;
      }
    }
  }
</style>
