export function trackEvent(
  name: string,
  params?: Record<string, string | number | boolean | null | undefined>
) {
  if (typeof window === 'undefined') return

  const gtag = (window as any).gtag

  if (typeof gtag !== 'function') return

  gtag('event', name, {
    app_name: 'tankaj',
    ...params,
  })
}
