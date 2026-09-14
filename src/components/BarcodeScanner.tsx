import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BrowserMultiFormatReader,
  BarcodeFormat,
  type IScannerControls,
} from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'

const SUPPORTED_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
]

const DEBOUNCE_MS = 1750

const FORMAT_LABELS: Record<number, string> = {
  [BarcodeFormat.EAN_13]: 'EAN-13',
  [BarcodeFormat.EAN_8]: 'EAN-8',
  [BarcodeFormat.UPC_A]: 'UPC-A',
  [BarcodeFormat.UPC_E]: 'UPC-E',
  [BarcodeFormat.CODE_128]: 'Code 128',
  [BarcodeFormat.CODE_39]: 'Code 39',
  [BarcodeFormat.ITF]: 'ITF',
}

type ScannerStatus = 'idle' | 'starting' | 'scanning' | 'error' | 'paused'

interface ScanRecord {
  id: string
  text: string
  format: string
  time: string
}

function formatBarcodeLabel(format: BarcodeFormat): string {
  return FORMAT_LABELS[format] ?? `Formato ${format}`
}

function formatScanTime(date: Date): string {
  return date.toLocaleTimeString('es-MX', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return 'Permiso de cámara denegado. Activa el acceso en la configuración del navegador.'
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'No se encontró ninguna cámara en este dispositivo.'
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'La cámara está en uso por otra aplicación o no responde.'
    }
    if (error.name === 'OverconstrainedError') {
      return 'No se pudo configurar la cámara con los requisitos solicitados.'
    }
    if (error.name === 'SecurityError') {
      return 'El acceso a la cámara requiere HTTPS o localhost.'
    }
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'No se pudo iniciar la cámara.'
}

function statusBadge(status: ScannerStatus) {
  switch (status) {
    case 'scanning':
      return (
        <span className="badge badge--success">
          <span className="badge__dot" aria-hidden="true" />
          Escaneando
        </span>
      )
    case 'starting':
      return <span className="badge badge--neutral">Iniciando…</span>
    case 'paused':
      return <span className="badge badge--warning">Pausado</span>
    case 'error':
      return <span className="badge badge--error">Error</span>
    default:
      return <span className="badge badge--neutral">Inactivo</span>
  }
}

export default function BarcodeScanner() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const cameraStartedAtRef = useRef<number | null>(null)
  const lastAcceptedRef = useRef<{ text: string; at: number } | null>(null)
  const firstScanRecordedRef = useRef(false)

  const [status, setStatus] = useState<ScannerStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastScan, setLastScan] = useState<ScanRecord | null>(null)
  const [recentScans, setRecentScans] = useState<ScanRecord[]>([])
  const [scanCount, setScanCount] = useState(0)
  const [firstScanMs, setFirstScanMs] = useState<number | null>(null)
  const [scanFlash, setScanFlash] = useState(false)

  const getReader = useCallback(() => {
    if (!readerRef.current) {
      const hints = new Map()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS)
      readerRef.current = new BrowserMultiFormatReader(hints)
    }
    return readerRef.current
  }, [])

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    BrowserMultiFormatReader.releaseAllStreams()

    const video = videoRef.current
    if (video) {
      BrowserMultiFormatReader.cleanVideoSource(video)
    }

    cameraStartedAtRef.current = null
    lastAcceptedRef.current = null
    firstScanRecordedRef.current = false
    setStatus('idle')
    setScanFlash(false)
  }, [])

  const handleScanResult = useCallback((text: string, format: BarcodeFormat) => {
    const now = Date.now()
    const lastAccepted = lastAcceptedRef.current

    if (lastAccepted && lastAccepted.text === text && now - lastAccepted.at < DEBOUNCE_MS) {
      return
    }

    lastAcceptedRef.current = { text, at: now }

    const scannedAt = new Date()
    const record: ScanRecord = {
      id: `${now}-${text}`,
      text,
      format: formatBarcodeLabel(format),
      time: formatScanTime(scannedAt),
    }

    setLastScan(record)
    setRecentScans((prev) => [record, ...prev].slice(0, 20))
    setScanCount((count) => count + 1)
    setScanFlash(true)
    window.setTimeout(() => setScanFlash(false), 300)

    if (navigator.vibrate) {
      navigator.vibrate(40)
    }

    if (!firstScanRecordedRef.current && cameraStartedAtRef.current !== null) {
      firstScanRecordedRef.current = true
      setFirstScanMs(now - cameraStartedAtRef.current)
    }
  }, [])

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error')
      setErrorMessage('Este navegador no soporta acceso a la cámara.')
      return
    }

    setStatus('starting')
    setErrorMessage(null)
    setFirstScanMs(null)
    firstScanRecordedRef.current = false
    lastAcceptedRef.current = null

    const video = videoRef.current
    if (!video) {
      setStatus('error')
      setErrorMessage('No se pudo preparar la vista previa de la cámara.')
      return
    }

    try {
      const reader = getReader()
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      }

      const controls = await reader.decodeFromConstraints(
        constraints,
        video,
        (result, error) => {
          if (result) {
            handleScanResult(result.getText(), result.getBarcodeFormat())
            return
          }

          if (error && error.name !== 'NotFoundException') {
            console.warn('Barcode scan error:', error)
          }
        },
      )

      controlsRef.current = controls
      cameraStartedAtRef.current = Date.now()
      setStatus('scanning')
    } catch (error) {
      setStatus('error')
      setErrorMessage(cameraErrorMessage(error))
      stopCamera()
    }
  }, [getReader, handleScanResult, stopCamera])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && controlsRef.current) {
        stopCamera()
        setStatus('paused')
        setErrorMessage('Escaneo pausado — volviste a otra pestaña o aplicación.')
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      controlsRef.current?.stop()
      BrowserMultiFormatReader.releaseAllStreams()
    }
  }, [stopCamera])

  const isCameraActive = status === 'starting' || status === 'scanning'

  return (
    <div className="scanner">
      <header className="scanner__header card">
        <div className="scanner__header-row">
          <div>
            <p className="label">Escáner de códigos</p>
            <h1 className="scanner__title">Prueba de escáner</h1>
          </div>
          {statusBadge(status)}
        </div>
        <p className="scanner__description">
          Mide qué tan rápido y confiable es escanear códigos de barras directamente
          desde un teléfono.
        </p>
      </header>

      <section className="scanner__viewport card card--flush" aria-live="polite">
        <div className={`scanner__video-wrap${isCameraActive ? ' scanner__video-wrap--active' : ''}`}>
          <video
            ref={videoRef}
            className="scanner__video"
            muted
            playsInline
            aria-hidden={!isCameraActive}
          />
          {isCameraActive && (
            <div className="scanner__guide" aria-hidden="true">
              <div className="scanner__guide-frame" />
              <span className="scanner__guide-label">Alinea el código horizontalmente</span>
            </div>
          )}
          {!isCameraActive && (
            <div className="scanner__placeholder">
              <p>La cámara se activa solo cuando presionas el botón.</p>
            </div>
          )}
        </div>
      </section>

      <section className="scanner__controls">
        {status === 'scanning' ? (
          <button type="button" className="btn btn--secondary btn--block" onClick={stopCamera}>
            Detener cámara
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={startCamera}
            disabled={status === 'starting'}
          >
            {status === 'starting' ? 'Iniciando cámara…' : 'Activar cámara'}
          </button>
        )}

        {status === 'error' && errorMessage && (
          <div className="alert alert--error" role="alert">
            {errorMessage}
          </div>
        )}

        {status === 'paused' && errorMessage && (
          <div className="alert alert--warning" role="status">
            {errorMessage}
          </div>
        )}
      </section>

      <section className="scanner__stats">
        <div className="stat card">
          <span className="stat__label label">Escaneos exitosos</span>
          <span className="stat__value">{scanCount}</span>
        </div>
        <div className="stat card">
          <span className="stat__label label">Primer escaneo</span>
          <span className="stat__value">
            {firstScanMs !== null ? `${(firstScanMs / 1000).toFixed(1)} s` : '—'}
          </span>
        </div>
      </section>

      {lastScan && (
        <section className={`scan-result card${scanFlash ? ' scan-result--flash' : ''}`}>
          <div className="scan-result__header">
            <p className="label">Código leído</p>
            <span className="badge badge--success">Leído</span>
          </div>
          <p className="scan-result__code">{lastScan.text}</p>
          <dl className="scan-result__meta">
            <div>
              <dt className="label">Formato</dt>
              <dd>{lastScan.format}</dd>
            </div>
            <div>
              <dt className="label">Hora</dt>
              <dd>{lastScan.time}</dd>
            </div>
          </dl>
        </section>
      )}

      {recentScans.length > 0 && (
        <section className="scan-history card">
          <h2 className="scan-history__title">Sesión actual</h2>
          <ul className="scan-history__list">
            {recentScans.map((scan, index) => (
              <li key={scan.id} className="scan-history__item">
                <span
                  className={`scan-history__indicator${index === 0 && scanFlash ? ' scan-history__indicator--flash' : ''}`}
                  aria-hidden="true"
                />
                <div className="scan-history__content">
                  <span className="scan-history__code">{scan.text}</span>
                  <span className="scan-history__meta">
                    {scan.format} · {scan.time}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="scanner__footer">
        <p className="label">
          Formatos: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, ITF
        </p>
      </footer>
    </div>
  )
}
