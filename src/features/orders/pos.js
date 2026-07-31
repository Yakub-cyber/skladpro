import { Wrench, Hammer, Zap, Droplets, PaintBucket, Package } from 'lucide-react'

// Настройки кассового оборудования по умолчанию. Живут в
// settings.pos — то есть общие для компании, но применяются только
// в POS-окне (/pos). Печать чека реализована через существующий
// DocPreviewModal (шаблон 'sale').
export const DEFAULT_POS = {
  autoPrint: false, // печатать чек сразу после оплаты
  receiptWidth: 80, // 58 | 80 мм — ширина ленты термопринтера
  scanSound: true, // звуковой сигнал при успешном сканировании
  scanMode: 'keyboard', // 'keyboard' (USB-сканер) | 'camera'
}

// Короткий «бип» после успешного сканирования. WebAudio вместо <audio>,
// чтобы не тащить бинарник в бандл и не упираться в autoplay-политику
// (звук инициируется пользовательским действием — сканом).
export function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = 1200
    gain.gain.value = 0.06
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.07)
    osc.onended = () => ctx.close()
  } catch {}
}

export const CAT_ICON = { Wrench, Hammer, Zap, Droplets, PaintBucket, Package }
