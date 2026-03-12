import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles.css';
import { AppLayout } from './components/layout/AppLayout';
import HomePage from './pages/HomePage';
import UploadPage from './pages/UploadPage';
import WatchPage from './pages/WatchPage';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';
import CreditHistoryPage from './pages/CreditHistoryPage';
import HowItWorksPage from './pages/HowItWorksPage';
import { ToastContainer } from './components/ui/Toast';
import { ThemeProvider } from './components/ThemeProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="entropy-ui-theme">
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AppLayout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/publish" element={<UploadPage />} />
            <Route path="/watch/:rootHash" element={<WatchPage />} />
            <Route path="/profile/:pubkey" element={<ProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/credits" element={<CreditHistoryPage />} />
            <Route path="/how-it-works" element={<HowItWorksPage />} />
          </Routes>
        </AppLayout>
        <ToastContainer />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
