import BarcodeScanner from './components/BarcodeScanner'

function App() {
  return (
    <div className="app-shell">
      <header className="letterhead">
        <div className="letterhead__row">
          <div className="brand">
            <span className="brand__name">Zeli</span>
            <span className="brand__product">Inventory</span>
          </div>
          <span className="badge">Prueba técnica</span>
        </div>
        <div className="rule" />
      </header>

      <main className="app-shell__content">
        <BarcodeScanner />
      </main>
    </div>
  )
}

export default App
