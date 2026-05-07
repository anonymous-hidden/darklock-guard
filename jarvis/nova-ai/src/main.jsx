import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import BuiltinPopoutShell from './BuiltinPopoutShell.jsx';
import './styles/index.css';

const params = new URLSearchParams(window.location.search);
const builtinId = params.get('builtin');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {builtinId ? <BuiltinPopoutShell id={builtinId} /> : <App />}
  </React.StrictMode>
);
