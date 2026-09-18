import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ThemeProvider, getInitialTheme } from './context/ThemeContext.jsx'
import { SystemProvider } from './context/SystemContext.jsx'
import './index.css'

const initial = getInitialTheme()
document.documentElement.setAttribute('data-theme', initial)
document.documentElement.classList.toggle('dark', initial === 'dark')
document.documentElement.classList.toggle('light', initial === 'light')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <SystemProvider>
        <App />
      </SystemProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
