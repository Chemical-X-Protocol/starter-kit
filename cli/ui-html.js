/**
 * Chemical X UI HTML Generator
 * Assembles styles, template, and client script with hydrated state
 */
import { UI_STYLES } from './ui-styles.js';
import { UI_TEMPLATE } from './ui-template.js';
import { UI_CLIENT_CERT_SCRIPT } from './ui-client-cert.js';
import { UI_CLIENT_API_SCRIPT } from './ui-client-api.js';
import { UI_CLIENT_SCRIPT } from './ui-client-script.js';

export const generateSwarmHtml = (initialState = {}) => {
  const jsonState = JSON.stringify(initialState).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chemical X: Live Swarm Social Network</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/vuetify@3.7.0/dist/vuetify.min.css" />
  <style>
${UI_STYLES}
  </style>
  <script src="https://unpkg.com/vue@3.5.42/dist/vue.global.prod.js"></script>
</head>
<body>
${UI_TEMPLATE}
  <script>
    window.__CHEMX_HYDRATED_STATE__ = ${jsonState};
${UI_CLIENT_CERT_SCRIPT}
${UI_CLIENT_API_SCRIPT}
${UI_CLIENT_SCRIPT}
  </script>
</body>
</html>`;
};
