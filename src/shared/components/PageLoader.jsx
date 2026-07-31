// Фолбэк Suspense при ленивой загрузке чанка страницы (code-splitting).
export default function PageLoader() {
  return (
    <div className="grid place-items-center py-24 text-muted" role="status" aria-label="Загрузка">
      <div className="h-8 w-8 rounded-full border-2 border-line border-t-brand animate-spin" />
    </div>
  )
}
