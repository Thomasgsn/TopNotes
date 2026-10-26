import { createApp } from "vue";
import App from "./App.vue";
import { i18n } from "./i18n";
import { appPersistence } from "./persistence";
import "./assets/styles/main.scss";

async function bootstrap(): Promise<void> {
  const initialData = await appPersistence.load();
  if (initialData.settings) i18n.global.locale.value = initialData.settings.locale;

  createApp(App, { initialData }).use(i18n).mount("#app");
}

void bootstrap().catch((error: unknown) => {
  console.error("TopNotes could not load its local data.", error);
  const root = document.querySelector<HTMLElement>("#app");
  if (root) root.textContent = "TopNotes could not load its local data.";
});
