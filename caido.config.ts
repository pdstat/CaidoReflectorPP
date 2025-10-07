import { defineConfig } from '@caido-community/dev';

const PLUGIN_VERSION = '0.1.0';

const id = "reflector";

export default defineConfig({
  id,
  name: "Reflector++",
  description: "Generates findings for reflected parameters in HTTP responses, including encoded reflections.",
  version: PLUGIN_VERSION,
  author: {
    name: "pdstat",
    email: "null@example.com",
    url: "https://github.com/pdstat/CaidoReflectorPP",
  },
  plugins: [
    {
      kind: "backend",
      id: "backend",
      root: "packages/backend",
    }
  ]
});