import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthGate } from './components/auth/AuthGate';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      {/* The redesigned studio lives at /; the previous layout stays at /classic during the rebuild */}
      <App variant={window.location.pathname.startsWith('/classic') ? 'classic' : 'studio'} />
    </AuthGate>
  </StrictMode>,
);
