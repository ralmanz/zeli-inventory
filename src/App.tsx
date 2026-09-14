import BarcodeScanner from './components/BarcodeScanner'

function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">Zeli</span>
          <span className="topbar__product">Inventory</span>
        </div>
        <span className="badge badge--neutral">Prueba técnica</span>
      </header>

      <main className="app-shell__content">
        <BarcodeScanner />
      </main>
    </div>
  )
}

export default App
