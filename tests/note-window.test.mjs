import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, test } from "node:test";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { useNoteWindow } from "../src/stores/noteWindow.ts";

beforeEach(() => {
  globalThis.window = {};
  globalThis.isTauri = true;
  mockWindows("main");
});

afterEach(() => {
  clearMocks();
  delete globalThis.window;
  delete globalThis.isTauri;
});

function mockNativeWindow({ maximized = false, fail = () => false } = {}) {
  const original = {
    size: { width: 2360, height: 1520 },
    position: { x: 180, y: 90 },
    maximized,
    decorated: true,
    titleBarStyle: "overlay",
    minimum: { Logical: { width: 860, height: 560 } },
  };
  const state = structuredClone(original);
  const calls = [];

  mockIPC((command, payload) => {
    const operation = command.replace("plugin:window|", "");
    const value = JSON.parse(JSON.stringify(payload)).value;
    calls.push(operation);
    if (fail(operation)) throw new Error("Simulated native window failure");
    switch (operation) {
      case "inner_size":
        return { ...state.size };
      case "outer_position":
        return { ...state.position };
      case "is_maximized":
        return state.maximized;
      case "is_decorated":
        return state.decorated;
      case "unmaximize":
        state.maximized = false;
        break;
      case "maximize":
        state.maximized = true;
        break;
      case "set_decorations":
        state.decorated = value;
        // macOS rebuilds the style mask and clears the full-size content view.
        state.titleBarStyle = "visible";
        break;
      case "set_title_bar_style":
        state.titleBarStyle = value;
        break;
      case "set_min_size":
        state.minimum = value;
        break;
      case "set_size": {
        const size = value.Physical ?? {
          width: value.Logical.width * 2,
          height: value.Logical.height * 2,
        };
        assert.ok(size.width >= state.minimum.Logical.width * 2);
        assert.ok(size.height >= state.minimum.Logical.height * 2);
        state.size = size;
        break;
      }
      case "set_position":
        state.position = value.Physical;
        break;
      default:
        throw new Error(`Unexpected native operation: ${operation}`);
    }
  });

  return { original, state, calls };
}

for (const maximized of [false, true]) {
  test(`compact mode restores the original window (maximized: ${maximized})`, async () => {
    const { original, state } = mockNativeWindow({ maximized });
    const mode = useNoteWindow();

    await mode.detach();
    assert.equal(mode.detached.value, true);
    assert.equal(mode.busy.value, false);
    assert.equal(state.decorated, false);
    assert.deepEqual(state.size, { width: 840, height: 960 });

    // The compact note can be moved and resized without losing the full window frame.
    state.position = { x: 1500, y: 300 };
    state.size = { width: 600, height: 500 };
    await mode.attach();
    assert.equal(mode.detached.value, false);
    assert.deepEqual(state, original);
  });
}

test("rapid repeated clicks cannot overwrite the saved full window frame", async () => {
  const { original, state, calls } = mockNativeWindow();
  const mode = useNoteWindow();
  await Promise.all([mode.detach(), mode.detach(), mode.detach()]);
  assert.equal(calls.filter((operation) => operation === "inner_size").length, 1);
  await mode.attach();
  assert.deepEqual(state, original);
});

test("repeated detach and attach cycles keep the controls inside the app header", async () => {
  const { original, state } = mockNativeWindow();
  const mode = useNoteWindow();
  for (let cycle = 0; cycle < 10; cycle++) {
    await mode.detach();
    await mode.attach();
    assert.deepEqual(state, original);
  }
  const capability = JSON.parse(await readFile("src-tauri/capabilities/default.json", "utf8"));
  assert.ok(capability.permissions.includes("core:window:allow-set-title-bar-style"));
});

test("a failed detach restores the full window", async (context) => {
  context.mock.method(console, "error", () => {});
  let shouldFail = true;
  const { original, state } = mockNativeWindow({
    fail: (operation) => {
      if (operation !== "set_size" || !shouldFail) return false;
      shouldFail = false;
      return true;
    },
  });
  const mode = useNoteWindow();
  await mode.detach();
  assert.equal(mode.detached.value, false);
  assert.equal(mode.busy.value, false);
  assert.deepEqual(state, original);
});

test("a failed return keeps the return button available for another attempt", async (context) => {
  context.mock.method(console, "error", () => {});
  let shouldFail = false;
  const { original, state } = mockNativeWindow({
    fail: (operation) => operation === "set_size" && shouldFail,
  });
  const mode = useNoteWindow();
  await mode.detach();
  shouldFail = true;
  await mode.attach();
  assert.equal(mode.detached.value, true);
  assert.equal(mode.busy.value, false);
  shouldFail = false;
  await mode.attach();
  assert.equal(mode.detached.value, false);
  assert.deepEqual(state, original);
});

test("the full window keeps native controls overlaid on the custom titlebar", async () => {
  const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
  const main = config.app.windows.find((window) => window.label === "main");
  assert.equal(main.decorations, true);
  assert.equal(main.titleBarStyle, "Overlay");
  assert.equal(main.hiddenTitle, true);
  assert.deepEqual(main.trafficLightPosition, { x: 14, y: 20 });
  assert.equal(main.transparent, true);
  assert.equal(main.backgroundColor, "#00000000");
});

test("browser preview supports detaching and returning without native IPC", async () => {
  globalThis.isTauri = false;
  const mode = useNoteWindow();
  await mode.detach();
  assert.equal(mode.detached.value, true);
  await mode.attach();
  assert.equal(mode.detached.value, false);
});
