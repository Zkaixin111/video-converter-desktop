import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// 全站样式入口：Tailwind 4 + 原型设计 Token + 组件类
import './styles/main.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
