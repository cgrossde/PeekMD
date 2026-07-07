import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './vendor/github-markdown.css';
import './vendor/syntect-github-light.css';
import './vendor/syntect-github-dark.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { applyTheme } from './lib/theme';

// Best-effort paint before the store hydrates the persisted override (avoids
// a flash of the wrong theme). App.tsx takes over from here once the real
// `ui.themeOverride` is known and keeps it in sync going forward.
applyTheme(null);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
