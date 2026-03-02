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
import HowItWorksPage from './pages/HowItWorksPage';
import { ToastContainer } from './components/ui/Toast';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/publish" element={<UploadPage />} />
          <Route path="/watch/:rootHash" element={<WatchPage />} />
          <Route path="/profile/:pubkey" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
        </Routes>
      </AppLayout>
      <ToastContainer />
    </BrowserRouter>
  </StrictMode>
);
