import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppWrapper } from './AppWrapper.tsx'
// Schriften liegen auf dem eigenen Server statt bei Google Fonts (keine IP-Übertragung an Google)
import '@fontsource-variable/bricolage-grotesque/opsz.css'
import '@fontsource-variable/dm-sans/opsz.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import './index.css'
// Polyfill for support react use in react 18
import "./polyfills/react-polyfill";
import { starteSprache } from './i18n';
import { appPlatform } from './utils/app-shell';

// App aus dem Store erkennen, bevor der Router die Adresse (?app=android) umschreibt
appPlatform();

// Erst die Sprache, dann die App: sonst blitzt jeder Text kurz auf Deutsch auf
starteSprache().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppWrapper />
    </StrictMode>,
  )
})
