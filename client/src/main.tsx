import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthGate } from './components/auth/AuthGate';
import './index.css';

// The old layout used to live at /classic
if (window.location.pathname.startsWith('/classic')) window.history.replaceState(null, '', '/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
);
