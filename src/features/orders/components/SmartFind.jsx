import { useEffect, useRef, useState } from 'react'
import { Search, Camera, X } from 'lucide-react'
import { cx } from '@/shared/ui'

// Единое поле «Поиск / штрихкод» + иконка камеры справа. Убирает вторую
// строку с большим ScannerInput наверху страницы — а весь ввод (текст /
// USB-сканер / камера) идёт в одно место. Автосабмит по Enter: если строка
// похожа на штрихкод (8+ цифр) — идёт в onScan, иначе просто поиск.
export default function SmartFind({ query, setQuery, onScan, msg, scanMode = 'camera' }) {
  const [cam, setCam] = useState(false)
  const [camErr, setCamErr] = useState('')
  const inputRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  // Кнопку камеры показываем, только если она реально нужна: браузер
  // умеет BarcodeDetector И в настройках кассы выбран режим 'camera'.
  // При USB-сканере (keyboard) кнопка только мешает — сканер и так
  // «печатает» код в это поле.
  const hasDetector =
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    scanMode === 'camera'

  const trySubmit = () => {
    const v = query.trim()
    if (/^\d{8,}$/.test(v)) {
      onScan(v)
      setQuery('')
      inputRef.current?.focus()
    }
  }

  useEffect(() => {
    if (!cam) return
    let raf
    let detector
    let stopped = false
    ;(async () => {
      try {
        detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'qr_code'],
        })
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        const tick = async () => {
          if (stopped || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes[0]?.rawValue) {
              onScan(String(codes[0].rawValue))
              setCam(false)
              return
            }
          } catch {}
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch {
        setCamErr('Камера недоступна. Используйте сканер или ручной ввод.')
        setCam(false)
      }
    })()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [cam, onScan])

  return (
    <div>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && trySubmit()}
          placeholder="Поиск товара или штрихкод…"
          className="w-full h-11 pl-9 pr-12 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-[15px]"
          autoFocus
        />
        {hasDetector && (
          <button
            onClick={() => {
              setCamErr('')
              setCam((v) => !v)
            }}
            title={cam ? 'Закрыть камеру' : 'Сканировать камерой'}
            className={cx(
              'absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-9 rounded-lg grid place-items-center transition',
              cam ? 'bg-bad text-white' : 'bg-surface hover:bg-surface-3 text-muted',
            )}
          >
            {cam ? <X size={16} /> : <Camera size={16} />}
          </button>
        )}
      </div>
      {camErr && <div className="mt-2 text-[12px] text-bad">{camErr}</div>}
      {msg && <div className="mt-2 text-[12px] text-bad">{msg}</div>}
      {cam && (
        <div className="mt-3 relative rounded-xl overflow-hidden border border-brand/40 bg-black aspect-video max-w-md">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-1/3 border-2 border-brand rounded-lg" />
          </div>
          <div className="absolute bottom-2 left-0 right-0 text-center text-white text-[12px]">
            Наведите камеру на штрихкод
          </div>
        </div>
      )}
    </div>
  )
}
