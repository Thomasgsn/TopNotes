import { isTauri } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readonly, ref } from "vue";

interface WindowFrame {
  size: PhysicalSize;
  position: PhysicalPosition;
  maximized: boolean;
}

export function useNoteWindow() {
  const detached = ref(false);
  const busy = ref(false);
  const nativeWindow = isTauri() ? getCurrentWindow() : null;
  let fullFrame: WindowFrame | null = null;

  async function restoreFrame(): Promise<void> {
    if (!nativeWindow || !fullFrame) return;
    await nativeWindow.unmaximize();
    await nativeWindow.setDecorations(true);
    // Re-enabling decorations on macOS resets the full-size content view.
    await nativeWindow.setTitleBarStyle("overlay");
    await nativeWindow.setMinSize(new LogicalSize(860, 560));
    await nativeWindow.setSize(fullFrame.size);
    await nativeWindow.setPosition(fullFrame.position);
    if (fullFrame.maximized) await nativeWindow.maximize();
  }

  async function detach(): Promise<void> {
    if (busy.value || detached.value) return;
    busy.value = true;
    try {
      if (nativeWindow) {
        const [size, position, maximized] = await Promise.all([
          nativeWindow.innerSize(),
          nativeWindow.outerPosition(),
          nativeWindow.isMaximized(),
        ]);
        fullFrame = { size, position, maximized };
        if (maximized) await nativeWindow.unmaximize();
        await nativeWindow.setMinSize(new LogicalSize(280, 220));
        await nativeWindow.setDecorations(false);
        await nativeWindow.setSize(new LogicalSize(420, 480));
      }
      detached.value = true;
    } catch (error) {
      console.error("TopNotes could not detach the note.", error);
      try {
        await restoreFrame();
        fullFrame = null;
      } catch (restoreError) {
        // Keep the return button available if a partial resize cannot be undone.
        detached.value = true;
        console.error("TopNotes could not restore the window.", restoreError);
      }
    } finally {
      busy.value = false;
    }
  }

  async function attach(): Promise<void> {
    if (busy.value || !detached.value) return;
    busy.value = true;
    try {
      await restoreFrame();
      detached.value = false;
      fullFrame = null;
    } catch (error) {
      console.error("TopNotes could not restore the window.", error);
    } finally {
      busy.value = false;
    }
  }

  return { detached: readonly(detached), busy: readonly(busy), detach, attach };
}
