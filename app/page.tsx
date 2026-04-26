'use client'

import { useMemo, useRef, useState } from 'react'

type Result = {
  location_id: string
  name: string
  brand: string | null
  address: string | null
  city: string | null
  country_code?: string | null
  lat: number
  lng: number
  distance_km: number
  estimated_drive_minutes: number
  fuel_type: string
  price: number
  fuel_cost: number
  travel_fuel_cost: number
  time_cost: number
  effective_total_cost: number
  tankaj_score?: number
  is_preferred_brand?: boolean
  is_cross_border?: boolean
  route_source?: string
  captured_at?: string
}

type Summary = {
  best_overall: Result | null
  nearest: Result | null
  cheapest_fuel: Result | null
  best_cross_border: Result | null
  preferred_best: Result | null
  saving_vs_nearest: number
  saving_vs_cheapest_fuel: number
}

type SearchStatus = 'idle' | 'location' | 'routing' | 'done' | 'error'

const BRANDS = [
  ['ALL', 'Vse znamke'],
  ['PETROL', 'Petrol'],
  ['MOL', 'MOL'],
  ['SHELL', 'Shell'],
  ['OMV', 'OMV'],
  ['MAXEN', 'Maxen'],
  ['INA', 'INA'],
  ['TIFON', 'Tifon'],
  ['CRODUX', 'Crodux'],
]

function brandShort(brand?: string | null) {
  if (!brand) return 'BS'
  return brand.slice(0, 3).toUpperCase()
}

function brandColor(brand?: string | null) {
  const b = (brand || '').toUpperCase()
  if (b.includes('PETROL')) return 'bg-red-600 text-white'
  if (b.includes('MOL')) return 'bg-red-700 text-white'
  if (b.includes('SHELL')) return 'bg-yellow-400 text-red-700'
  if (b.includes('OMV')) return 'bg-white text-emerald-700'
  if (b.includes('INA')) return 'bg-blue-700 text-white'
  return 'bg-white/90 text-[#10251b]'
}

export default function Home() {
  const [fuelType, setFuelType] = useState('PETROL_95')
  const [radius, setRadius] = useState(50)
  const [amount, setAmount] = useState(50)
  const [brand, setBrand] = useState('ALL')
  const [preferredBrand, setPreferredBrand] = useState('NONE')
  const [tripMode, setTripMode] = useState('return')
  const [sortBy, setSortBy] = useState('smart')
  const [visibleCount, setVisibleCount] = useState(6)

  const [results, setResults] = useState<Result[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [searched, setSearched] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const activeRequestId = useRef(0)

  const loading = status === 'location' || status === 'routing'
  const best = summary?.best_overall || results?.[0] || null
  const nearest = summary?.nearest || null
  const crossBorder = summary?.best_cross_border || null
  const preferredPick = summary?.preferred_best || null

  const visibleResults = results.slice(0, visibleCount)

  const lastUpdated = useMemo(() => {
    if (!best?.captured_at) return null
    const diffMin = Math.max(0, Math.round((Date.now() - new Date(best.captured_at).getTime()) / 60000))
    if (diffMin < 1) return 'pravkar'
    if (diffMin < 60) return `pred ${diffMin} min`
    return `pred ${Math.round(diffMin / 60)} h`
  }, [best])

  async function search() {
    const requestId = ++activeRequestId.current
    setSearched(true)
    setStatus('location')
    setSummary(null)
    setVisibleCount(6)

    if (!navigator.geolocation) {
      alert('Tvoj brskalnik ne podpira zaznave lokacije.')
      setStatus('error')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (requestId !== activeRequestId.current) return
        setStatus('routing')

        try {
          const lat = position.coords.latitude
          const lng = position.coords.longitude

          const res = await fetch(
            `/api/search?lat=${lat}&lng=${lng}&type=${fuelType}&radius=${radius}&amount=${amount}&brand=${brand}&preferredBrand=${preferredBrand === 'NONE' ? '' : preferredBrand}&tripMode=${tripMode}&sortBy=${sortBy}`
          )

          const json = await res.json()
          if (requestId !== activeRequestId.current) return

          setResults(json.results || [])
          setSummary(json.summary || null)
          setStatus('done')
        } catch {
          if (requestId !== activeRequestId.current) return
          setStatus('error')
        }
      },
      () => {
        if (requestId !== activeRequestId.current) return
        alert('Lokacije ni bilo mogoče pridobiti. Dovoli dostop do lokacije in poskusi znova.')
        setStatus('error')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  function mapsUrl(item: Result) {
    return `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}`
  }

  async function shareResult() {
    if (!best) return
    const saving = Number(summary?.saving_vs_nearest || 0)
    const text =
      saving > 0.2
        ? `Tankaj.si mi je našel pametnejšo izbiro za tankanje. Prihranek: približno ${saving.toFixed(2)} €.`
        : `Tankaj.si mi je našel najbolj smiselno črpalko glede na ceno, razdaljo in strošek poti.`

    if (navigator.share) {
      await navigator.share({ title: 'Tankaj.si', text, url: window.location.origin })
      return
    }

    await navigator.clipboard.writeText(`${text} ${window.location.origin}`)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 1800)
  }

  function MainResultCard({ item }: { item: Result }) {
    const saving = Number(summary?.saving_vs_nearest || 0)

    return (
      <div className="relative overflow-hidden rounded-[34px] border border-[#b9fb6a]/35 bg-[#10251b] p-5 text-white shadow-[0_24px_80px_rgba(7,32,22,.28)] md:p-7">
        <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#b9fb6a]/15 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />

        <div className="relative">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-white/60">Najboljša izbira za vas</div>
            <div className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
              {item.country_code || 'SI'}
              {item.is_cross_border ? ' · čez mejo' : ''}
            </div>
          </div>

          <div className="mt-5 rounded-[26px] border border-[#b9fb6a]/35 bg-white/[0.08] p-4 shadow-inner md:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-sm font-black ${brandColor(item.brand)}`}>
                  {brandShort(item.brand)}
                </div>

                <div>
                  <div className="text-2xl font-semibold tracking-tight md:text-3xl">{item.name}</div>
                  <div className="mt-1 text-sm text-white/55">
                    {item.address}
                    {item.city ? `, ${item.city}` : ''}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-lg font-semibold">{item.distance_km} km</div>
                <div className="text-sm text-white/55">~{item.estimated_drive_minutes} min</div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <DarkMetric label="Cena" value={`${item.price.toFixed(3)} €/L`} />
              <DarkMetric label="Gorivo" value={`${Number(item.fuel_cost || 0).toFixed(2)} €`} />
              <DarkMetric label="Pot" value={`${Number(item.travel_fuel_cost || 0).toFixed(2)} €`} />
              <div className="rounded-2xl bg-[#b9fb6a] p-4 text-[#10251b]">
                <div className="text-sm opacity-70">Končni strošek</div>
                <div className="mt-1 text-2xl font-black">
                  {Number(item.effective_total_cost || 0).toFixed(2)} €
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-3 text-sm text-white/65">
              Izračun: gorivo {Number(item.fuel_cost || 0).toFixed(2)} € + pot{' '}
              {Number(item.travel_fuel_cost || 0).toFixed(2)} € + čas{' '}
              {Number(item.time_cost || 0).toFixed(2)} € ={' '}
              <span className="font-semibold text-white">
                {Number(item.effective_total_cost || 0).toFixed(2)} €
              </span>
            </div>
          </div>

          {saving > 0.2 && (
            <div className="mt-4 rounded-2xl bg-[#b9fb6a]/15 px-4 py-3 text-[#b9fb6a]">
              <span className="font-semibold">Prihranek:</span> približno {saving.toFixed(2)} € proti najbližji možnosti.
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={mapsUrl(item)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl bg-white px-5 py-3 font-semibold text-[#10251b]"
            >
              Odpri navigacijo
            </a>

            <button
              onClick={shareResult}
              className="rounded-2xl border border-white/15 px-5 py-3 font-semibold text-white hover:bg-white/10"
            >
              {shareCopied ? 'Kopirano ✓' : 'Deli rezultat'}
            </button>
          </div>

          <div className="mt-4 text-xs text-white/40">
            Čas vožnje je ocena brez Google prometnih podatkov.
          </div>
        </div>
      </div>
    )
  }

  function CompactResult({ item, label }: { item: Result; label?: string }) {
    return (
      <a
        href={mapsUrl(item)}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-[26px] border border-white/8 bg-white/[0.06] p-4 text-white backdrop-blur transition hover:bg-white/[0.09]"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xs font-black ${brandColor(item.brand)}`}>
              {brandShort(item.brand)}
            </div>

            <div className="min-w-0">
              <div className="truncate text-lg font-semibold">
                {item.name}
                {item.is_preferred_brand && (
                  <span className="ml-2 rounded-full bg-[#b9fb6a]/20 px-2 py-1 text-xs text-[#b9fb6a]">
                    preferirana
                  </span>
                )}
              </div>
              <div className="mt-1 truncate text-sm text-white/45">
                {label || item.address}
              </div>
              <div className="mt-2 text-2xl font-black text-[#b9fb6a]">
                {item.price.toFixed(3)} €/L
              </div>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold text-white/80">{item.distance_km} km</div>
            <div className="mt-1 text-xs text-white/45">~{item.estimated_drive_minutes} min</div>
            <div className="mt-2 text-xs text-white/45">Skupaj</div>
            <div className="font-bold text-[#b9fb6a]">
              {Number(item.effective_total_cost || 0).toFixed(2)} €
            </div>
          </div>
        </div>
      </a>
    )
  }

  return (
    <main className="min-h-screen bg-[#071a12] text-white">
      <section className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
        <div className="grid gap-6 lg:grid-cols-[.9fr_1.1fr]">
          <div className="rounded-[36px] border border-white/10 bg-[#0b2117] p-5 shadow-[0_30px_90px_rgba(0,0,0,.35)] md:p-7">
            <div className="flex items-center justify-between">
              <div className="text-3xl font-black italic tracking-tight">
                Tankaj<span className="text-[#b9fb6a]">.si</span>
              </div>
              <div className="rounded-full bg-[#b9fb6a]/15 px-3 py-1 text-sm font-medium text-[#b9fb6a]">
                BETA
              </div>
            </div>

            <div className="mt-5 flex items-center gap-2 text-white/60">
              <span className="text-[#b9fb6a]">⌖</span>
              <span>Slovenija + Hrvaška</span>
            </div>

            <div className="mt-7">
              <h1 className="max-w-xl text-5xl font-black tracking-tight md:text-6xl">
                Ne tankaj več na pamet.
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-white/62">
                Tankaj.si izračuna najboljšo izbiro glede na ceno goriva, razdaljo,
                strošek poti, čas in tvoje preference.
              </p>
            </div>

            <div id="kalkulator" className="mt-7 rounded-[28px] border border-white/10 bg-white/[0.06] p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <SelectDark label="Gorivo" value={fuelType} onChange={setFuelType} options={[['PETROL_95', 'Bencin 95'], ['DIESEL', 'Dizel']]} />
                <SelectDark label="Radius" value={String(radius)} onChange={(v) => setRadius(Number(v))} options={[['5', '5 km'], ['10', '10 km'], ['25', '25 km'], ['50', '50 km'], ['100', '100 km'], ['200', '200 km']]} />

                <label>
                  <span className="mb-2 block text-sm text-white/50">Količina</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    type="number"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-[#b9fb6a]/70"
                  />
                </label>

                <SelectDark label="Prikaži znamke" value={brand} onChange={setBrand} options={BRANDS} />
                <SelectDark label="Preferirana znamka" value={preferredBrand} onChange={setPreferredBrand} options={[['NONE', 'Brez preference'], ...BRANDS.filter(([v]) => v !== 'ALL')]} />
                <SelectDark label="Način poti" value={tripMode} onChange={setTripMode} options={[['return', 'Grem samo tankat'], ['oneway', 'Je spotoma / grem v to smer']]} />
                <SelectDark label="Razvrsti po" value={sortBy} onChange={setSortBy} options={[['smart', 'Najboljša skupna izbira'], ['total', 'Najnižji skupni strošek'], ['price', 'Najnižja cena €/L'], ['distance', 'Najbližje']]} />

                <button
                  onClick={search}
                  disabled={loading}
                  className="rounded-2xl bg-[#b9fb6a] px-5 py-3 font-black text-[#10251b] shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 md:mt-7"
                >
                  {status === 'location' ? 'Pridobivam lokacijo ...' : status === 'routing' ? 'Računam izbiro ...' : 'Preveri najboljšo izbiro'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 text-sm text-white/55 md:grid-cols-3">
              <InfoDark title="Gorivo" text="Cena × količina." />
              <InfoDark title="Pot" text="Vožnja do črpalke." />
              <InfoDark title="Čas" text="Privzeto 6 €/h." />
            </div>
          </div>

          <div className="min-h-[560px] rounded-[36px] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(185,251,106,.16),transparent_35%),linear-gradient(180deg,#0c2519,#071a12)] p-5 shadow-[0_30px_90px_rgba(0,0,0,.35)] md:p-7">
            {loading && (
              <div className="rounded-[30px] border border-white/10 bg-white/[0.06] p-5">
                <div className="text-sm text-white/55">
                  {status === 'location' ? 'Pridobivam tvojo lokacijo ...' : 'Primerjam črpalke, cene in strošek poti ...'}
                </div>
                <div className="mt-5 h-10 w-64 animate-pulse rounded-full bg-white/10" />
                <div className="mt-6 space-y-3">
                  <div className="h-24 animate-pulse rounded-3xl bg-white/10" />
                  <div className="h-20 animate-pulse rounded-3xl bg-white/10" />
                  <div className="h-20 animate-pulse rounded-3xl bg-white/10" />
                </div>
              </div>
            )}

            {searched && !loading && status === 'done' && results.length === 0 && (
              <div className="rounded-[30px] border border-white/10 bg-white/[0.06] p-6 text-white/70">
                V izbranem radiusu trenutno ni zadetkov. Poskusi povečati radius ali prikazati vse znamke.
              </div>
            )}

            {searched && !loading && status === 'error' && (
              <div className="rounded-[30px] border border-white/10 bg-white/[0.06] p-6 text-white/70">
                Pri iskanju je prišlo do napake. Poskusi znova.
              </div>
            )}

            {!searched && !loading && (
              <div className="flex h-full min-h-[520px] flex-col justify-center">
                <div className="text-sm text-white/45">Primer logike</div>
                <div className="mt-3 text-3xl font-black tracking-tight">
                  Najnižja cena na liter ni vedno najboljša izbira.
                </div>

                <div className="mt-6 space-y-3">
                  <div className="rounded-3xl bg-white/[0.08] p-4">
                    <div className="text-sm text-white/45">Črpalka A</div>
                    <div className="mt-1 text-2xl font-black text-[#b9fb6a]">1.605 €/L · 5 km stran</div>
                  </div>
                  <div className="rounded-3xl bg-white/[0.08] p-4">
                    <div className="text-sm text-white/45">Črpalka B</div>
                    <div className="mt-1 text-2xl font-black text-[#b9fb6a]">1.589 €/L · 28 km stran</div>
                  </div>
                  <div className="rounded-3xl bg-[#b9fb6a] p-4 text-[#10251b]">
                    <div className="text-sm opacity-70">Tankaj.si preveri razliko</div>
                    <div className="mt-1 text-2xl font-black">manj vožnje je lahko cenejše kot nižja cena</div>
                  </div>
                </div>
              </div>
            )}

            {!loading && best && (
              <>
                <MainResultCard item={best} />

                <div className="mt-7 text-2xl font-black tracking-tight">Druge odlične možnosti</div>

                <div className="mt-4 space-y-3">
                  {preferredPick && preferredPick.location_id !== best.location_id && (
                    <CompactResult item={preferredPick} label="Najboljša preferirana znamka" />
                  )}

                  {crossBorder && crossBorder.location_id !== best.location_id && (
                    <CompactResult item={crossBorder} label="Najboljša izbira čez mejo" />
                  )}

                  {nearest && nearest.location_id !== best.location_id && (
                    <CompactResult item={nearest} label="Najbližja možnost" />
                  )}

                  {visibleResults
                    .filter((item) => item.location_id !== best.location_id)
                    .map((item) => (
                      <CompactResult key={item.location_id} item={item} />
                    ))}
                </div>

                {lastUpdated && (
                  <div className="mt-4 text-sm text-white/40">Cene so bile nazadnje posodobljene {lastUpdated}.</div>
                )}

                {results.length > visibleCount && (
                  <div className="mt-5 flex justify-center">
                    <button
                      onClick={() => setVisibleCount((v) => v + 6)}
                      className="rounded-2xl border border-white/10 bg-white/[0.06] px-6 py-4 font-semibold text-white hover:bg-white/[0.09]"
                    >
                      Naloži več rezultatov
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <section className="mt-12 rounded-[34px] border border-white/10 bg-white/[0.04] p-6 text-white md:p-8">
          <h2 className="text-3xl font-black tracking-tight">Kako deluje?</h2>

          <p className="mt-4 max-w-4xl text-lg leading-relaxed text-white/60">
            Tankaj.si ne primerja samo cene na liter, ampak izračuna približen skupni
            strošek tankanja. Upoštevamo ceno goriva, količino, ocenjeno realno vožnjo
            do črpalke, povprečno porabo vozila 7 L/100 km in ocenjeno vrednost časa 6 €/h.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <InfoDark title="Formula" text="gorivo + pot + čas = končni strošek" />
            <InfoDark title="Način poti" text="Lahko računaš tja in nazaj ali kot spotoma." />
            <InfoDark title="Cilj" text="Optimiziramo odločitev, ne samo cene." />
          </div>
        </section>
      </section>
    </main>
  )
}

function DarkMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-4">
      <div className="text-sm text-white/55">{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
    </div>
  )
}

function InfoDark({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
      <div className="font-semibold text-white">{title}</div>
      <div className="mt-1 text-sm text-white/50">{text}</div>
    </div>
  )
}

function SelectDark({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[][]
}) {
  return (
    <label>
      <span className="mb-2 block text-sm text-white/50">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-[#b9fb6a]/70"
      >
        {options.map(([value, label]) => (
          <option key={value} value={value} className="bg-[#10251b] text-white">
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}