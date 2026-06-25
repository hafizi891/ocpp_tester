import React from 'react';
import ReactDOM from 'react-dom/client';

const isCustomer = window.location.pathname.startsWith('/user');

let Root;
if (isCustomer) {
  const { default: CustomerApp } = await import('./CustomerApp.jsx');
  await import('./styles/customer.css');
  Root = CustomerApp;
} else {
  const { default: App } = await import('./App.jsx');
  await import('./styles/globals.css');
  Root = App;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
