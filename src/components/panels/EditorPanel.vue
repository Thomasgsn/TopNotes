<script setup lang="ts">
  import {
    Archive,
    ArrowLeft,
    Bold,
    EllipsisVertical,
    ExternalLink,
    Heading,
    Info,
    Italic,
    Link2,
    List,
    ListChecks,
    Pin,
    PinOff,
    RotateCcw,
    SquarePen,
    Trash2,
    Underline,
    Keyboard,
    X,
  } from "@lucide/vue";
  import { computed, nextTick, ref } from "vue";
  import { useI18n } from "vue-i18n";
  import { noteText } from "@/app/editor/markdown";
  import type { LinkDraft } from "@/app/editor/links";
  import type { Note, NoteTag, TagId } from "@/app/types";
  import IconButton from "../base/IconButton.vue";
  import MarkdownEditor from "../base/MarkdownEditor.vue";
  import Popover from "../base/Popover.vue";
  import LinkDialog from "../dialogs/LinkDialog.vue";

  const props = defineProps<{
    note: Note | null;
    alwaysOnTop: boolean;
    alwaysOnTopBusy: boolean;
    detached: boolean;
    noteWindowBusy: boolean;
    tags: NoteTag[];
    tagName: (tag: NoteTag) => string;
  }>();

  const emit = defineEmits<{
    newNote: [];
    updateTitle: [title: string];
    updateBody: [body: string];
    convertBody: [body: string];
    updateTag: [tag: TagId | null];
    togglePin: [];
    toggleArchive: [];
    restore: [];
    trashOrDelete: [];
    toggleAlwaysOnTop: [];
    detach: [];
    attach: [];
    openShortcuts: [];
  }>();

  const { t, locale } = useI18n();
  const editorElement = ref<InstanceType<typeof MarkdownEditor> | null>(null);
  const infoVisible = ref(false);
  const actionsVisible = ref(false);
  const linkDraft = ref<LinkDraft | null>(null);

  const plainBody = computed(() => (props.note ? noteText(props.note) : ""));
  const wordCount = computed(() => (plainBody.value ? plainBody.value.split(/\s+/u).length : 0));
  const characterCount = computed(() => plainBody.value.length);

  function runCommand(command: string, value?: string): void {
    editorElement.value?.format(command, value);
  }

  function addLink(): void {
    editorElement.value?.openLink();
  }

  function saveLink(url: string, label: string): void {
    if (linkDraft.value) editorElement.value?.saveLink(linkDraft.value, url, label);
    closeLink();
  }

  function deleteLink(): void {
    if (linkDraft.value) editorElement.value?.deleteLink(linkDraft.value);
    closeLink();
  }

  function closeLink(): void {
    linkDraft.value = null;
    void nextTick(() => editorElement.value?.focusEditor());
  }

  function setTag(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    emit("updateTag", value ? (value as TagId) : null);
  }

  function formatDate(timestamp: number): string {
    return new Intl.DateTimeFormat(locale.value, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(timestamp);
  }
</script>

<template>
  <article
    class="editor"
    :class="{ 'editor--detached': detached }"
    :aria-label="note?.title || t('app.untitled')"
  >
    <header class="editor__titlebar" data-tauri-drag-region>
      <div class="editor__actions">
        <IconButton
          :icon="alwaysOnTop ? Pin : PinOff"
          :size="17"
          :fill="alwaysOnTop ? 'currentColor' : 'none'"
          :label="t(alwaysOnTop ? 'app.alwaysOnTop' : 'app.keepOnTop')"
          :pressed="alwaysOnTop"
          :disabled="alwaysOnTopBusy"
          @click="emit('toggleAlwaysOnTop')"
        />

        <IconButton
          v-if="!detached"
          :icon="Keyboard"
          :size="17"
          :label="t('shortcuts.title')"
          @click="emit('openShortcuts')"
        />

        <IconButton
          v-if="detached"
          :icon="ArrowLeft"
          :size="17"
          :label="t('actions.attachNote')"
          :disabled="noteWindowBusy"
          @click="emit('attach')"
        />

        <Popover
          v-if="!detached"
          :open="infoVisible && note !== null"
          variant="info"
          :label="t('info.title')"
          @close="infoVisible = false"
        >
          <template #trigger="{ panelId }">
            <IconButton
              :icon="Info"
              :size="17"
              :label="t('nav.noteInfo')"
              :disabled="!note"
              :expanded="infoVisible"
              :aria-controls="panelId"
              @click.stop="
                infoVisible = !infoVisible;
                actionsVisible = false;
              "
            />
          </template>
          <template v-if="note">
            <div class="popover__heading">
              <strong>{{ t("info.title") }}</strong>
              <button
                class="popover__close"
                type="button"
                :aria-label="t('nav.close')"
                @click="infoVisible = false"
              >
                <X :size="14" />
              </button>
            </div>
            <dl class="popover__details">
              <div class="popover__row">
                <dt>{{ t("info.created") }}</dt>
                <dd>{{ formatDate(note.createdAt) }}</dd>
              </div>
              <div class="popover__row">
                <dt>{{ t("info.updated") }}</dt>
                <dd>{{ formatDate(note.updatedAt) }}</dd>
              </div>
              <div class="popover__row popover__row--tag">
                <dt>{{ t("info.tag") }}</dt>
                <dd>
                  <select class="popover__select" :value="note.tag ?? ''" @change="setTag">
                    <option value="">{{ t("info.none") }}</option>
                    <option v-for="tag in tags" :key="tag.id" :value="tag.id">
                      {{ tagName(tag) }}
                    </option>
                  </select>
                </dd>
              </div>
            </dl>
          </template>
        </Popover>

        <Popover
          v-if="!detached"
          :open="actionsVisible && note !== null"
          variant="actions"
          :label="t('nav.more')"
          @close="actionsVisible = false"
        >
          <template #trigger="{ panelId }">
            <IconButton
              :icon="EllipsisVertical"
              :size="17"
              :label="t('nav.more')"
              :disabled="!note"
              :expanded="actionsVisible"
              :aria-controls="panelId"
              @click.stop="
                actionsVisible = !actionsVisible;
                infoVisible = false;
              "
            />
          </template>
          <template v-if="note">
            <button
              class="popover__action"
              type="button"
              role="menuitem"
              :disabled="noteWindowBusy"
              @click="
                actionsVisible = false;
                emit('detach');
              "
            >
              <ExternalLink :size="14" />
              <span>{{ t("actions.detachNote") }}</span>
            </button>
            <div class="popover__divider"></div>
            <button
              class="popover__action"
              type="button"
              role="menuitem"
              @click="
                emit('togglePin');
                actionsVisible = false;
              "
            >
              <Pin :size="14" />
              <span>{{ note.pinned ? t("actions.unpin") : t("actions.pin") }}</span>
            </button>
            <button
              v-if="!note.trashed"
              class="popover__action"
              type="button"
              role="menuitem"
              @click="
                emit('toggleArchive');
                actionsVisible = false;
              "
            >
              <RotateCcw v-if="note.archived" :size="14" />
              <Archive v-else :size="14" />
              <span>{{ note.archived ? t("actions.restore") : t("actions.archive") }}</span>
            </button>
            <button
              v-if="note.trashed"
              class="popover__action"
              type="button"
              role="menuitem"
              @click="
                emit('restore');
                actionsVisible = false;
              "
            >
              <RotateCcw :size="14" />
              <span>{{ t("actions.restore") }}</span>
            </button>
            <div class="popover__divider"></div>
            <button
              class="popover__action popover__action--destructive"
              type="button"
              role="menuitem"
              @click="
                emit('trashOrDelete');
                actionsVisible = false;
              "
            >
              <Trash2 :size="14" />
              <span>{{
                note.trashed ? t("actions.deleteForever") : t("actions.moveToTrash")
              }}</span>
            </button>
          </template>
        </Popover>
      </div>
    </header>

    <template v-if="note">
      <div class="editor__scroll">
        <div class="editor__document">
          <time
            v-if="!detached"
            class="editor__date"
            :datetime="new Date(note.updatedAt).toISOString()"
            >{{ formatDate(note.updatedAt) }}
          </time>
          <input
            class="editor__title"
            type="text"
            :value="note.title"
            :placeholder="t('app.untitled')"
            :aria-label="t('app.untitled')"
            @input="emit('updateTitle', ($event.target as HTMLInputElement).value)"
          />
          <MarkdownEditor
            :key="note.id"
            ref="editorElement"
            class="editor__content"
            :body="note.body"
            :body-format="note.bodyFormat"
            :placeholder="t('app.startWriting')"
            @update="emit('updateBody', $event)"
            @convert="emit('convertBody', $event)"
            @edit-link="linkDraft = $event"
          />
        </div>
      </div>

      <footer v-if="!detached" class="editor__footer">
        <div class="editor__format-bar" aria-label="Text formatting">
          <button
            class="editor__format-button"
            type="button"
            :aria-label="t('actions.heading')"
            :title="t('actions.heading')"
            @click="runCommand('formatBlock', 'h2')"
          >
            <Heading :size="16" />
          </button>
          <button
            class="editor__format-button"
            type="button"
            :aria-label="t('actions.checklist')"
            :title="t('actions.checklist')"
            @click="runCommand('insertText', '☐ ')"
          >
            <ListChecks :size="17" />
          </button>
          <button
            class="editor__format-button"
            type="button"
            :aria-label="t('actions.list')"
            :title="t('actions.list')"
            @click="runCommand('insertUnorderedList')"
          >
            <List :size="17" />
          </button>
          <i class="editor__format-divider"></i>
          <button
            class="editor__format-button"
            type="button"
            :aria-label="t('actions.bold')"
            :title="t('actions.bold')"
            @click="runCommand('bold')"
          >
            <Bold :size="16" />
          </button>
          <button
            class="editor__format-button"
            type="button"
            :aria-label="t('actions.italic')"
            :title="t('actions.italic')"
            @click="runCommand('italic')"
          >
            <Italic :size="16" />
          </button>
          <button
            class="editor__format-button"
            type="button"
            :aria-label="t('actions.underline')"
            :title="t('actions.underline')"
            @click="runCommand('underline')"
          >
            <Underline :size="16" />
          </button>
          <button
            class="editor__format-button"
            type="button"
            :aria-label="t('actions.link')"
            :title="t('actions.link')"
            @click="addLink"
          >
            <Link2 :size="16" />
          </button>
        </div>
        <span class="editor__statistics"
          >{{ t("app.words", wordCount) }} ·
          {{ t("app.characters", { count: characterCount }) }}</span
        >
      </footer>
    </template>

    <div v-else class="editor__empty">
      <SquarePen :size="24" />
      <strong class="editor__empty-title">{{ t("app.noNotes") }}</strong>
      <button class="editor__empty-action" type="button" @click="emit('newNote')">
        {{ t("nav.newNote") }}
      </button>
    </div>
    <LinkDialog
      v-if="linkDraft"
      :draft="linkDraft"
      @save="saveLink"
      @remove="deleteLink"
      @close="closeLink"
    />
  </article>
</template>

<style lang="scss" scoped>
  @use "@/styles/lib/placeholders/editor";

  .editor {
    position: relative;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--paper);

    &__titlebar {
      height: 54px;
      padding: 0 16px 0 22px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex: 0 0 54px;
      border-bottom: 1px solid var(--line);
      user-select: none;
      -webkit-app-region: drag;
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
      overflow: hidden auto;
    }

    &__document {
      width: min(680px, calc(100% - 60px));
      min-height: 100%;
      margin: 0 auto;
      padding-block: 32px calc(32px * 2);
    }

    &__date {
      display: block;
      margin-bottom: 9px;
      color: var(--accent);
      font-size: 9px;
      font-weight: 720;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    &__title {
      width: 100%;
      margin: 0 0 24px;
      padding: 0;
      border: 0;
      outline: 0;
      color: #323231;
      background: transparent;
      font-size: 30px;
      font-weight: 730;
      letter-spacing: -0.035em;
      line-height: 1.18;

      &::placeholder {
        color: #b2b2af;
      }
    }

    &__footer {
      position: relative;
      height: 44px;
      padding: 0 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: 0 0 44px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      background: rgb(255 255 255 / 97%);
      font-size: 9px;
    }

    &__saving-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--muted);
      animation: editor-pulse 900ms ease-in-out infinite alternate;
    }

    &__format-bar {
      position: absolute;
      left: 50%;
      bottom: 12px;
      z-index: 5;
      min-height: 40px;
      padding: 5px 7px;
      display: flex;
      align-items: center;
      gap: 2px;
      transform: translateX(-50%);
      border: 1px solid rgb(28 30 31 / 7%);
      border-radius: 10px;
      background: #f2f2f1;
      box-shadow: 0 5px 18px rgb(30 31 32 / 9%);
    }

    &__format-button {
      width: 29px;
      height: 29px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      color: #666663;
      background: transparent;
      cursor: pointer;

      &:hover {
        color: #3d3d3b;
        background: #fff;
      }
    }

    &__format-divider {
      width: 1px;
      height: 18px;
      margin: 0 4px;
      background: #d8d8d5;
    }

    &__empty {
      flex: 1;
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

    &--detached {
      .editor__titlebar {
        height: 40px;
        padding: 0 10px;
        flex-basis: 40px;
        border-bottom: 0;
      }

      .editor__document {
        width: calc(100% - 48px);
        padding-block: 12px 32px;
      }

      .editor__title {
        margin-bottom: 20px;
        font-size: 22px;
      }

      .editor__content {
        min-height: 120px;
      }
    }
  }

  @keyframes editor-pulse {
    to {
      opacity: 0.35;
    }
  }

  @media (width <= 980px) {
    .editor__document {
      width: calc(100% - 56px);
    }
  }

  @media (prefers-color-scheme: dark) {
    .editor {
      &__title,
      &__content,
      &__content strong {
        color: #f2f2ef;
      }

      &__footer {
        background: rgb(36 37 38 / 97%);
      }

      &__format-bar {
        border-color: #444647;
        background: #363839;
      }

      &__format-button {
        color: #c7c7c3;

        &:hover {
          color: #fff;
          background: #47494a;
        }
      }
    }
  }
</style>
