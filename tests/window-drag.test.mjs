import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const titlebars = [
  ["src/components/panels/NavigationPanel.vue", "navigation__titlebar"],
  ["src/components/panels/NotesPanel.vue", "notes__titlebar"],
  ["src/components/panels/EditorPanel.vue", "editor__titlebar"],
];

test("each custom titlebar starts the native Tauri window drag", async () => {
  for (const [file, className] of titlebars) {
    const source = await readFile(file, "utf8");
    const titlebar = new RegExp(
      `<header(?=[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'])(?=[^>]*\\bdata-tauri-drag-region(?:=["'][^"']*["'])?)[^>]*>`,
    );

    assert.match(source, titlebar, `${file} must expose its titlebar as a Tauri drag region`);
  }

  const capability = JSON.parse(await readFile("src-tauri/capabilities/default.json", "utf8"));
  assert.ok(
    capability.permissions.includes("core:window:allow-start-dragging"),
    "the main window capability must allow Tauri's start_dragging command",
  );
});
