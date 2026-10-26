<script setup lang="ts">
  defineProps<{ message: string; actionLabel: string }>();
  const emit = defineEmits<{ undo: [] }>();
</script>

<template>
  <div class="undo-toast" role="status">
    <span class="undo-toast__message">{{ message }}</span>
    <button class="undo-toast__action" type="button" @click="emit('undo')">
      {{ actionLabel }}
    </button>
  </div>
</template>

<style lang="scss" scoped>
  .undo-toast {
    position: absolute;
    bottom: 62px;
    left: 50%;
    z-index: $z-index-toast;
    max-width: calc(100% - 32px);
    padding: 8px 8px 8px 14px;
    display: flex;
    align-items: center;
    gap: 14px;
    border-radius: 10px;
    color: var(--nav-text);
    background: var(--nav);
    box-shadow: 0 12px 36px rgb(20 22 24 / 22%);
    font-size: 12px;
    transform: translateX(-50%);

    &__message {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__action {
      flex: 0 0 auto;
      padding: 5px 10px;
      border-radius: 6px;
      color: #fff;
      background: var(--accent);
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
    }
  }
</style>
