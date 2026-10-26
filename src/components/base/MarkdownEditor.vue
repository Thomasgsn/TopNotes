<script setup lang="ts">
  import type { EditorProps } from "@tiptap/pm/view";
  import { EditorContent, useEditor } from "@tiptap/vue-3";
  import { watch } from "vue";
  import { markdownExtensions } from "@/app/editor/markdown";
  import {
    applyLink,
    linkHrefAt,
    openExternalLink,
    readLinkDraft,
    removeLink,
  } from "@/app/editor/links";
  import type { LinkDraft } from "@/app/editor/links";

  const props = defineProps<{
    body: string;
    bodyFormat?: "markdown";
    placeholder: string;
  }>();
  const emit = defineEmits<{
    update: [markdown: string];
    convert: [markdown: string];
    editLink: [draft: LinkDraft];
  }>();

  // setOptions replaces editorProps as a whole, so build them in one place.
  function editorProps(placeholder: string): EditorProps {
    return {
      attributes: {
        class: "markdown-editor__input",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": placeholder,
        "data-placeholder": placeholder,
      },
      // Links are edited with a plain click; Cmd/Ctrl-click opens them.
      handleClick: (view, position, event) => {
        if (!event.metaKey && !event.ctrlKey) return false;
        const href = linkHrefAt(view.state, position);
        if (!href) return false;
        openExternalLink(href);
        return true;
      },
    };
  }

  const editor = useEditor({
    extensions: markdownExtensions({ openLink }),
    content: props.body,
    contentType: props.bodyFormat === "markdown" ? "markdown" : "html",
    editorProps: editorProps(props.placeholder),
    onCreate: ({ editor: current }) => {
      if (props.bodyFormat !== "markdown") emit("convert", current.getMarkdown());
    },
    onUpdate: ({ editor: current }) => emit("update", current.getMarkdown()),
  });

  watch(
    () => props.placeholder,
    (placeholder) => editor.value?.setOptions({ editorProps: editorProps(placeholder) }),
  );

  function openLink(): void {
    if (editor.value) emit("editLink", readLinkDraft(editor.value));
  }

  function saveLink(draft: LinkDraft, url: string, label: string): void {
    if (editor.value) applyLink(editor.value, draft, url, label);
  }

  function deleteLink(draft: LinkDraft): void {
    if (editor.value) removeLink(editor.value, draft);
  }

  function focusEditor(): void {
    editor.value?.commands.focus();
  }

  function format(command: string, value?: string): void {
    const chain = editor.value?.chain().focus();
    if (!chain) return;
    switch (command) {
      case "formatBlock":
        chain.toggleHeading({ level: 2 }).run();
        break;
      case "insertText":
        chain.toggleTaskList().run();
        break;
      case "insertUnorderedList":
        chain.toggleBulletList().run();
        break;
      case "bold":
        chain.toggleBold().run();
        break;
      case "italic":
        chain.toggleItalic().run();
        break;
      case "underline":
        chain.toggleUnderline().run();
        break;
      case "createLink":
        if (value) chain.setLink({ href: value }).run();
        break;
    }
  }

  defineExpose({ format, openLink, saveLink, deleteLink, focusEditor });
</script>

<template>
  <EditorContent class="markdown-editor" :editor="editor" />
</template>

<style lang="scss">
  @use "@/styles/lib/placeholders/editor";

  .markdown-editor {
    &__input {
      @extend %editor;

      &:has(> p:only-child > br:only-child)::after {
        position: absolute;
        top: 0;
        left: 0;
        color: var(--muted);
        content: attr(data-placeholder);
        pointer-events: none;
      }

      h1,
      h2,
      h3,
      h4,
      h5,
      h6 {
        margin: 24px 0 12px;
        color: var(--text);
        line-height: 1.3;
      }

      h1 {
        font-size: 28px;
      }

      h2 {
        font-size: 23px;
      }

      h3 {
        font-size: 19px;
      }

      h4,
      h5,
      h6 {
        font-size: 16px;
      }

      ul {
        list-style-type: disc;
      }

      ol {
        list-style-type: decimal;
      }

      li > p {
        margin-bottom: 4px;
      }

      ul[data-type="taskList"] {
        padding-left: 0;
        list-style: none;

        > li {
          display: flex;
          align-items: flex-start;
          gap: 9px;

          > label {
            flex: 0 0 auto;
            padding-top: 2px;
            user-select: none;
          }

          > div {
            flex: 1;
            min-width: 0;
          }

          &[data-checked="true"] > div > p {
            color: var(--muted);
            text-decoration: line-through;
          }
        }

        input[type="checkbox"] {
          appearance: auto;
          width: 14px;
          height: 14px;
          margin: 0;
          accent-color: var(--accent);
          cursor: pointer;

          &:not(:checked) {
            appearance: none;
            border: 1.5px solid var(--muted);
            border-radius: 4px;
            background: transparent;
          }

          &:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
          }
        }
      }

      code {
        padding: 2px 4px;
        border-radius: 4px;
        background: var(--hover);
        font-family: ui-monospace, monospace;
        font-size: 0.9em;
      }

      pre {
        padding: 14px;
        overflow-x: auto;
        border-radius: 8px;
        background: var(--hover);

        code {
          padding: 0;
          background: transparent;
        }
      }

      > :first-child {
        margin-top: 0;
      }
    }
  }

  .editor--detached .markdown-editor__input {
    min-height: 120px;
  }

  @media (prefers-color-scheme: dark) {
    .markdown-editor__input,
    .markdown-editor__input strong {
      color: var(--text);
    }
  }
</style>
