import { Classic } from "@caido/primevue";
import PrimeVue from "primevue/config";
import { createApp } from "vue";

import { SDKPlugin } from "./plugins/sdk";
import { Reflector } from "@/types"
import "./styles/index.css";
import type { FrontendSDK } from "./types";
import Settings from "./views/Settings.vue";

// This is the entry point for the frontend plugin
export const init = (sdk: FrontendSDK) => {
  Reflector.init(sdk);
  const app = createApp(Settings);

  // Load the PrimeVue component library
  app.use(PrimeVue, {
    unstyled: true,
    pt: Classic,
  });

  // Provide the FrontendSDK
  app.use(SDKPlugin, sdk);

  // Create the root element for the app
  const root = document.createElement("div");
  Object.assign(root.style, {
    height: "100%",
    width: "100%",
  });

  // Set the ID of the root element
  // Replace this with the value of the prefixWrap plugin in caido.config.ts
  // This is necessary to prevent styling conflicts between plugins
  root.id = `plugin--reflector`;

  // Mount the app to the root element
  app.mount(root);

  // Add the page to the navigation
  // Make sure to use a unique name for the page
  sdk.navigation.addPage("/reflector-config", {
    body: root,
  });

  // Add a sidebar item
  sdk.sidebar.registerItem("Reflector++", "/reflector-config", {
    icon: "fas fa-biohazard"
  });
};
