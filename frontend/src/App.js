// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import LoginPage from './LoginPage';
import AIDocumentProcessor from './AIDocumentProcessor';

const App = () => {
  return (
    <ThemeProvider>
      <Router>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/ai-document-processor" element={<AIDocumentProcessor />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export default App;