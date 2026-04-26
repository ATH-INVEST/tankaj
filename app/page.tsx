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

const sortOptions = [
  ['smart', 'Najboljša izbira'],
  ['total', 'Najnižji skupni strošek'],
  ['price', 'Najnižja cena €/L'],
  ['distance', 'Najbližje'],
]

function brandShort(brand?: string | null) {
  if (!brand) return 'BS'
  const b = brand.toUpperCase()
  if (b.includes('PETROL')) return 'P'
  if (b.includes('SHELL')) return 'SH'
  if (b.includes('MOL')) return 'MOL'
  if (b.includes('INA')) return 'INA'
  if (b.includes('TIFON')) return 'TF'
  if (b.includes('CRODUX')) return 'CR'
  if (b.includes('OMV')) return 'OMV'
  return b.slice(0, 3)
}

function brandColor(brand?: string | null) {
  const b = (brand || '').toUpperCase()
  if (b.includes('PETROL')) return 'bg-[#ee1b2f] text-white'
  if (b.includes('MOL')) return 'bg-[#c8192e] text-white'
  if (b.includes('SHELL')) return 'bg-[#ffd84d] text-[#7a1600]'
  if (b.includes('OMV')) return 'bg-white text-[#007a5e]'
  if (b.includes('INA')) return 'bg-[#0067b1] text-white'
  if (b.includes('TIFON')) return 'bg-[#1f4bff] text-white'
  return 'bg-white/90 text-[#0b1f16]'
}

function formatMoney(value?: number | null) {
  return `${Number(value || 0).toFixed(2)} €`
}

function formatKm(value?: number | null) {
  return `${Number(value || 0).toFixed(2).replace('.00', '')} km`
}

export default function Home() {
  const [fuelType, setFuelType] = useState('PETROL_95')
  const [radius, setRadius] = useState(50)
  const [amount, setAmount] = useState(50)
  const [brand, setBrand] = useState('ALL')
  const [preferredBrand, setPreferredBrand] = useState('NONE')
  const [tripMode, setTripMode] = useState('return')
  const [sortBy, setSortBy] = useState('smart')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [visibleCount, setVisibleCount] = useState(5)

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

  const visibleResults = useMemo(() => {
    const unique = new Map<string, Result>()
    for (const item of results) {
      if (best?.location_id === item.location_id) continue
      if (!unique.has(item.location_id)) unique.set(item.location_id, item)
    }
    return Array.from(unique.values()).slice(0, visibleCount)
  }, [results, best, visibleCount])

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
    setVisibleCount(5)

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

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#06140f] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(185,251,106,.23),transparent_28%),radial-gradient(circle_at_92%_12%,rgba(44,120,76,.24),transparent_34%),linear-gradient(180deg,#071a12_0%,#04100b_100%)]" />

      <section className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-7">
        <div className="grid flex-1 gap-4 lg:grid-cols-[.9fr_1.1fr] xl:gap-5">
          <HeroSearch
            fuelType={fuelType}
            setFuelType={setFuelType}
            radius={radius}
            setRadius={setRadius}
            amount={amount}
            setAmount={setAmount}
            brand={brand}
            setBrand={setBrand}
            preferredBrand={preferredBrand}
            setPreferredBrand={setPreferredBrand}
            tripMode={tripMode}
            setTripMode={setTripMode}
            sortBy={sortBy}
            setSortBy={setSortBy}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
            loading={loading}
            status={status}
            search={search}
          />

          <ResultPanel
            best={best}
            nearest={nearest}
            crossBorder={crossBorder}
            preferredPick={preferredPick}
            visibleResults={visibleResults}
            resultsLength={results.length}
            visibleCount={visibleCount}
            setVisibleCount={setVisibleCount}
            loading={loading}
            searched={searched}
            status={status}
            lastUpdated={lastUpdated}
            summary={summary}
            amount={amount}
            mapsUrl={mapsUrl}
            shareResult={shareResult}
            shareCopied={shareCopied}
          />
        </div>

        <HowItWorks />
      </section>
    </main>
  )
}

function HeroSearch({
  fuelType,
  setFuelType,
  radius,
  setRadius,
  amount,
  setAmount,
  brand,
  setBrand,
  preferredBrand,
  setPreferredBrand,
  tripMode,
  setTripMode,
  sortBy,
  setSortBy,
  showAdvanced,
  setShowAdvanced,
  loading,
  status,
  search,
}: any) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-white/[0.055] p-4 shadow-[0_25px_80px_rgba(0,0,0,.25)] backdrop-blur-2xl sm:p-6 lg:min-h-[680px] lg:p-7">
      <div className="flex items-center justify-between gap-4">
        <div className="text-3xl font-black italic tracking-tight sm:text-4xl">
          Tankaj<span className="text-[#b9fb6a]">.si</span>
        </div>
        <div className="rounded-full bg-[#b9fb6a]/18 px-3 py-1 text-xs font-black tracking-wide text-[#b9fb6a]">
          BETA
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 text-sm text-white/58">
        <span className="text-[#b9fb6a]">⌖</span>
        <span>Slovenija + Hrvaška</span>
      </div>

      <h1 className="mt-6 max-w-xl text-[48px] font-black leading-[.93] tracking-[-.055em] sm:text-[64px] lg:text-[66px] xl:text-[72px]">
        Ne tankaj več na pamet.
      </h1>

      <p className="mt-5 max-w-lg text-base leading-relaxed text-white/60 sm:text-lg">
        Tankaj.si izračuna najboljšo izbiro glede na ceno goriva, razdaljo, strošek poti, čas in tvoje preference.
      </p>

      <div className="mt-6 rounded-[26px] border border-white/10 bg-[#123024]/72 p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectDark label="Gorivo" value={fuelType} onChange={setFuelType} options={[['PETROL_95', 'Bencin 95'], ['DIESEL', 'Dizel']]} />
          <SelectDark label="Radius" value={String(radius)} onChange={(v) => setRadius(Number(v))} options={[['5', '5 km'], ['10', '10 km'], ['25', '25 km'], ['50', '50 km'], ['100', '100 km'], ['200', '200 km']]} />

          <label>
            <span className="mb-1.5 block text-xs font-semibold text-white/50">Količina</span>
            <input
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              type="number"
              className="h-12 w-full rounded-2xl border border-white/10 bg-[#071a12] px-4 text-[15px] font-semibold text-white outline-none transition focus:border-[#b9fb6a]/70"
            />
          </label>

          <SelectDark label="Razvrsti po" value={sortBy} onChange={setSortBy} options={sortOptions} />

          {showAdvanced && (
            <>
              <SelectDark label="Znamke" value={brand} onChange={setBrand} options={BRANDS} />
              <SelectDark label="Preferirana znamka" value={preferredBrand} onChange={setPreferredBrand} options={[['NONE', 'Brez preference'], ...BRANDS.filter(([v]) => v !== 'ALL')]} />
              <SelectDark label="Način poti" value={tripMode} onChange={setTripMode} options={[['return', 'Grem samo tankat'], ['oneway', 'Je spotoma / grem v to smer']]} />
            </>
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced((v: boolean) => !v)}
            className="h-12 rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-left text-sm font-semibold text-white/75 transition hover:bg-white/[0.08]"
          >
            {showAdvanced ? 'Skrij nastavitve' : 'Napredne nastavitve'}
          </button>

          <button
            onClick={search}
            disabled={loading}
            className="h-12 rounded-2xl bg-[#b9fb6a] px-5 text-sm font-black text-[#071a12] shadow-[0_12px_30px_rgba(185,251,106,.22)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 sm:col-span-2"
          >
            {status === 'location' ? 'Pridobivam lokacijo ...' : status === 'routing' ? 'Računam izbiro ...' : 'Preveri najboljšo izbiro'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniInfo title="Gorivo" text="Cena × količina" />
        <MiniInfo title="Pot" text="Realna vožnja" />
        <MiniInfo title="Čas" text="Privzeto 6 €/h" />
      </div>
    </div>
  )
}

function ResultPanel({
  best,
  nearest,
  crossBorder,
  preferredPick,
  visibleResults,
  resultsLength,
  visibleCount,
  setVisibleCount,
  loading,
  searched,
  status,
  lastUpdated,
  summary,
  mapsUrl,
  shareResult,
  shareCopied,
}: any) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(185,251,106,.18),transparent_32%),linear-gradient(180deg,rgba(15,48,34,.86),rgba(5,20,14,.88))] p-4 shadow-[0_25px_80px_rgba(0,0,0,.25)] backdrop-blur-2xl sm:p-6 lg:min-h-[680px] lg:p-7">
      {loading && <LoadingState status={status} />}

      {searched && !loading && status === 'done' && !best && (
        <EmptyState text="V izbranem radiusu trenutno ni zadetkov. Poskusi povečati radius ali prikazati vse znamke." />
      )}

      {searched && !loading && status === 'error' && (
        <EmptyState text="Pri iskanju je prišlo do napake. Poskusi znova." />
      )}

      {!searched && !loading && <ExampleState />}

      {!loading && best && (
        <>
          <BestCard item={best} summary={summary} mapsUrl={mapsUrl} shareResult={shareResult} shareCopied={shareCopied} />

          <div className="mt-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black tracking-tight">Druge odlične možnosti</h2>
            {lastUpdated && <div className="text-xs text-white/40">Cene {lastUpdated}</div>}
          </div>

          <div className="mt-3 space-y-2.5">
            {preferredPick && preferredPick.location_id !== best.location_id && (
              <CompactResult item={preferredPick} label="Preferirana znamka" mapsUrl={mapsUrl} />
            )}

            {crossBorder && crossBorder.location_id !== best.location_id && (
              <CompactResult item={crossBorder} label="Čez mejo" mapsUrl={mapsUrl} />
            )}

            {nearest && nearest.location_id !== best.location_id && (
              <CompactResult item={nearest} label="Najbližja možnost" mapsUrl={mapsUrl} />
            )}

            {visibleResults.map((item: Result) => (
              <CompactResult key={item.location_id} item={item} mapsUrl={mapsUrl} />
            ))}
          </div>

          {resultsLength > visibleCount && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setVisibleCount((v: number) => v + 5)}
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-bold text-white transition hover:bg-white/[0.1]"
              >
                Naloži več rezultatov
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function BestCard({ item, summary, mapsUrl, shareResult, shareCopied }: any) {
  const saving = Number(summary?.saving_vs_nearest || 0)

  return (
    <div className="rounded-[28px] border border-[#b9fb6a]/35 bg-[#071a12]/65 p-4 shadow-[0_18px_60px_rgba(0,0,0,.24)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[.26em] text-[#b9fb6a]">Najboljša izbira</div>
          <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{item.name}</h2>
          <div className="mt-2 text-sm text-white/50">
            {item.address}
            {item.city ? `, ${item.city}` : ''}
          </div>
        </div>

        <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/65">
          {item.country_code || 'SI'}
        </div>
      </div>

      <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.075] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xs font-black ${brandColor(item.brand)}`}>
              {brandShort(item.brand)}
            </div>
            <div>
              <div className="text-xs text-white/45">Cena goriva</div>
              <div className="text-3xl font-black text-[#b9fb6a]">{item.price.toFixed(3)} €/L</div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs text-white/45">Vožnja</div>
            <div className="font-black">{formatKm(item.distance_km)}</div>
            <div className="text-xs text-white/45">~{item.estimated_drive_minutes} min</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <CostPill label="Gorivo" value={formatMoney(item.fuel_cost)} />
          <CostPill label="Pot" value={formatMoney(item.travel_fuel_cost)} />
          <CostPill label="Čas" value={formatMoney(item.time_cost)} />
        </div>

        <div className="mt-3 rounded-2xl bg-[#b9fb6a] p-4 text-[#071a12]">
          <div className="text-xs font-black uppercase tracking-[.2em] opacity-70">Končni strošek</div>
          <div className="mt-1 text-3xl font-black">{formatMoney(item.effective_total_cost)}</div>
        </div>
      </div>

      {saving > 0.2 && (
        <div className="mt-3 rounded-2xl bg-[#b9fb6a]/14 px-4 py-3 text-sm text-[#b9fb6a]">
          <span className="font-black">Prihranek:</span> približno {saving.toFixed(2)} € proti najbližji možnosti.
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href={mapsUrl(item)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-2xl bg-white px-4 py-3 text-center text-sm font-black text-[#071a12]"
        >
          Navigacija
        </a>
        <button
          onClick={shareResult}
          className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-white transition hover:bg-white/[0.08]"
        >
          {shareCopied ? 'Kopirano ✓' : 'Deli'}
        </button>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-white/35">
        Izračun je ocena. Google Maps lahko pokaže drugačen čas zaradi prometa ali prehoda meje.
      </p>
    </div>
  )
}

function CompactResult({ item, label, mapsUrl }: { item: Result; label?: string; mapsUrl: (item: Result) => string }) {
  return (
    <a
      href={mapsUrl(item)}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-[22px] border border-white/8 bg-white/[0.06] p-3 transition hover:bg-white/[0.09]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xs font-black ${brandColor(item.brand)}`}>
            {brandShort(item.brand)}
          </div>

          <div className="min-w-0">
            <div className="truncate text-sm font-black text-white">{item.name}</div>
            <div className="mt-0.5 truncate text-[11px] text-white/40">{label || item.address}</div>
            <div className="mt-1 text-lg font-black text-[#b9fb6a]">{item.price.toFixed(3)} €/L</div>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-xs font-black text-white/80">{formatKm(item.distance_km)}</div>
          <div className="text-[11px] text-white/40">~{item.estimated_drive_minutes} min</div>
          <div className="mt-1 text-[10px] text-white/40">skupaj</div>
          <div className="text-sm font-black text-[#b9fb6a]">{formatMoney(item.effective_total_cost)}</div>
        </div>
      </div>
    </a>
  )
}

function ExampleState() {
  return (
    <div className="flex h-full min-h-[520px] flex-col justify-center">
      <div className="text-xs font-black uppercase tracking-[.28em] text-[#b9fb6a]">Primer logike</div>
      <h2 className="mt-3 max-w-xl text-4xl font-black leading-tight tracking-tight">
        Najnižja cena na liter ni vedno najboljša izbira.
      </h2>

      <div className="mt-7 space-y-3">
        <div className="rounded-3xl bg-white/[0.07] p-4">
          <div className="text-sm text-white/45">Črpalka A</div>
          <div className="mt-1 text-2xl font-black text-[#b9fb6a]">1.605 €/L · 5 km stran</div>
        </div>

        <div className="rounded-3xl bg-white/[0.07] p-4">
          <div className="text-sm text-white/45">Črpalka B</div>
          <div className="mt-1 text-2xl font-black text-[#b9fb6a]">1.589 €/L · 28 km stran</div>
        </div>

        <div className="rounded-3xl bg-[#b9fb6a] p-4 text-[#071a12]">
          <div className="text-sm opacity-70">Tankaj.si preveri razliko</div>
          <div className="mt-1 text-2xl font-black">manj vožnje je lahko cenejše kot nižja cena</div>
        </div>
      </div>
    </div>
  )
}

function LoadingState({ status }: { status: SearchStatus }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.06] p-5">
      <div className="text-sm font-semibold text-white/55">
        {status === 'location' ? 'Pridobivam tvojo lokacijo ...' : 'Primerjam črpalke, cene in strošek poti ...'}
      </div>
      <div className="mt-5 h-10 w-64 animate-pulse rounded-full bg-white/10" />
      <div className="mt-6 space-y-3">
        <div className="h-40 animate-pulse rounded-3xl bg-white/10" />
        <div className="h-20 animate-pulse rounded-3xl bg-white/10" />
        <div className="h-20 animate-pulse rounded-3xl bg-white/10" />
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.06] p-6 text-white/65">
      {text}
    </div>
  )
}

function CostPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-3">
      <div className="text-[10px] font-black uppercase tracking-[.18em] text-white/38">{label}</div>
      <div className="mt-1 text-sm font-black">{value}</div>
    </div>
  )
}

function MiniInfo({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
      <div className="text-sm font-black text-white">{title}</div>
      <div className="mt-1 text-xs text-white/45">{text}</div>
    </div>
  )
}

function HowItWorks() {
  return (
    <section className="mt-5 rounded-[30px] border border-white/10 bg-white/[0.055] p-5 backdrop-blur-2xl sm:p-7">
      <h2 className="text-3xl font-black tracking-tight">Kako deluje?</h2>
      <p className="mt-4 max-w-4xl text-sm leading-relaxed text-white/60 sm:text-base">
        Tankaj.si ne primerja samo cene na liter, ampak izračuna približen skupni strošek tankanja.
        Upoštevamo ceno goriva, količino, ocenjeno realno vožnjo do črpalke, povprečno porabo vozila 7 L/100 km in ocenjeno vrednost časa 6 €/h.
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <MiniInfo title="Formula" text="gorivo + pot + čas = končni strošek" />
        <MiniInfo title="Način poti" text="Računaš tja in nazaj ali kot spotoma." />
        <MiniInfo title="Cilj" text="Optimiziramo odločitev, ne samo cene." />
      </div>
    </section>
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
      <span className="mb-1.5 block text-xs font-semibold text-white/50">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full appearance-none rounded-2xl border border-white/10 bg-[#071a12] bg-[linear-gradient(45deg,transparent_50%,rgba(255,255,255,.6)_50%),linear-gradient(135deg,rgba(255,255,255,.6)_50%,transparent_50%)] bg-[length:5px_5px,5px_5px] bg-[position:calc(100%-18px)_21px,calc(100%-13px)_21px] bg-no-repeat px-4 pr-10 text-[15px] font-semibold text-white outline-none transition focus:border-[#b9fb6a]/70"
      >
        {options.map(([value, label]) => (
          <option key={value} value={value} className="bg-[#071a12] text-white">
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}
