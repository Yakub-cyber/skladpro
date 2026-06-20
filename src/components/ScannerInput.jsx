import { useEffect, useRef, useState } from 'react'
import { ScanLine, Camera, X, Keyboard } from 'lucide-react'
import { Button, cx } from './ui'

// Поле приёма штрихкода. Работает с аппаратным USB-сканером (он эмулирует
// клавиатуру + Enter) и с камерой через BarcodeDetector API (Chrome/Android).
export default function ScannerInput({ onScan, placeholder = 'Отсканируйте или введите штрихкод' }) {
  const [val, setVal] = useState('')
  const [cam, setCam] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const hasDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window

  const submit = (code) => {
    const v = String(code).trim()
    if (!v) return
    onScan(v)
    setVal('')
    inputRef.current?.focus()
  }

  // Камера + распознавание
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
              submit(codes[0].rawValue)
              setCam(false)
              return
            }
          } catch {}
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch (e) {
        setErr('Камера недоступна. Используйте сканер или ручной ввод.')
        setCam(false)
      }
    })()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [cam])

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanLine size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand" />
          <input
            ref={inputRef}
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit(val)}
            placeholder={placeholder}
            className="w-full h-12 pl-10 pr-3 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-[15px] tracking-wide"
          />
        </div>
        <Button variant="soft" onClick={() => submit(val)} disabled={!val}>
          ОК
        </Button>
        {hasDetector && (
          <Button
            variant={cam ? 'danger' : 'soft'}
            icon={cam ? X : Camera}
            onClick={() => {
              setErr('')
              setCam((v) => !v)
            }}
          >
            <span className="hidden sm:inline">{cam ? 'Стоп' : 'Камера'}</span>
          </Button>
        )}
      </div>

      {err && <div className="mt-2 text-[12px] text-bad">{err}</div>}

      {cam && (
        <div className="mt-3 relative rounded-xl overflow-hidden border border-brand/40 bg-black aspect-video max-w-md">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-1/3 border-2 border-brand rounded-lg" />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 w-3/4 h-0.5 bg-brand/80 route-flow" />
          </div>
          <div className="absolute bottom-2 left-0 right-0 text-center text-white text-[12px]">
            Наведите камеру на штрихкод
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
        <Keyboard size={13} /> USB-сканер вводит код автоматически и нажимает Enter
      </div>
    </div>
  )
}
