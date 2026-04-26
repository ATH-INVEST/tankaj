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
  is_cross_border?: boolean
  route_source?: string
  captured_at?: string
  recommendation_reason?: string | null
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
  ['smart', 'Priporočeno'],
  ['price', 'Najcenejše €/L'],
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
  const [sortBy, setSortBy] = useState('smart')
  const [appMode, setAppMode] = useState<'nearby' | 'route'>('nearby')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showOthers, setShowOthers] = useState(false)

  const [winner, setWinner] = useState<Result | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [searched, setSearched] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const activeRequestId = useRef(0)

  const loading = status === 'location' || status === 'routing'
  const best = winner || results?.[0] || null

  const otherResults = useMemo(() => {
    const unique = new Map<string, Result>()
    for (const item of results) {
      if (best?.location_id === item.location_id) continue
      if (!unique.has(item.location_id)) unique.set(item.location_id, item)
    }
    return Array.from(unique.values())
  }, [results, best])

  const nearest = useMemo(() => {
    if (!results.length) return null
    return [...results].sort((a, b) => a.distance_km - b.distance_km)[0] || null
  }, [results])

  const savingVsNearest = useMemo(() => {
    if (!best || !nearest || best.location_id === nearest.location_id) return 0
    return Number((nearest.effective_total_cost - best.effective_total_cost).toFixed(2))
  }, [best, nearest])

  const lastUpdated = useMemo(() => {
    if (!best?.captured_at) return null
    const diffMin = Math.max(0, Math.round((Date.now() - new Date(best.captured_at).getTime()) / 60000))
    if (diffMin < 1) return 'pravkar'
    if (diffMin < 60) return `pred ${diffMin} min`
    return `pred ${Math.round(diffMin / 60)} h`
  }, [best])

  async function search() {
    if (appMode === 'route') {
      alert('Način “Na poti” dodamo v naslednjem koraku. Za zdaj uporabi “Okoli mene”.')
      return
    }

    const requestId = ++activeRequestId.current
    setSearched(true)
    setShowOthers(false)
    setStatus('location')
    setWinner(null)
    setResults([])

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
            `/api/search?lat=${lat}&lng=${lng}&type=${fuelType}&radius=${radius}&amount=${amount}&brand=${brand}&mode=${appMode}&sortBy=${sortBy}`
          )

          const json = await res.json()
          if (requestId !== activeRequestId.current) return

          setWinner(json.winner || json.results?.[0] || null)
          setResults(json.results || [])
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

    const text =
      savingVsNearest > 0.2
        ? `Tankaj.si mi je našel boljšo izbiro za tankanje. Prihranek: približno ${savingVsNearest.toFixed(2)} €.`
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

      <section className="relative mx-auto flex min-h-screen max-w-[1320px] flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-7">
        <div className="grid flex-1 gap-4 lg:grid-cols-2 xl:gap-6">
          <HeroSearch
            fuelType={fuelType}
            setFuelType={setFuelType}
            radius={radius}
            setRadius={setRadius}
            amount={amount}
            setAmount={setAmount}
            brand={brand}
            setBrand={setBrand}
            sortBy={sortBy}
            setSortBy={setSortBy}
            appMode={appMode}
            setAppMode={setAppMode}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
            loading={loading}
            status={status}
            search={search}
          />

          <ResultPanel
            best={best}
            otherResults={otherResults}
            showOthers={showOthers}
            setShowOthers={setShowOthers}
            loading={loading}
            searched={searched}
            status={status}
            lastUpdated={lastUpdated}
            savingVsNearest={savingVsNearest}
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
  sortBy,
  setSortBy,
  appMode,
  setAppMode,
  showAdvanced,
  setShowAdvanced,
  loading,
  status,
  search,
}: any) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-white/[0.055] p-4 shadow-[0_25px_80px_rgba(0,0,0,.25)] backdrop-blur-2xl sm:p-6 lg:min-h-[720px] lg:p-8">
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

      <h1 className="mt-6 max-w-xl text-[48px] font-black leading-[.93] tracking-[-.055em] sm:text-[64px] lg:text-[72px] xl:text-[78px]">
        Ne tankaj več na pamet.
      </h1>

      <p className="mt-5 max-w-lg text-base leading-relaxed text-white/60 sm:text-lg">
        Izberi radij, gorivo in količino. Tankaj.si nato primerja ceno, realno pot do črpalke in ocenjen čas.
      </p>

      <ModeSwitch appMode={appMode} setAppMode={setAppMode} />

      {appMode === 'route' && (
        <div className="mt-4 rounded-[22px] border border-[#b9fb6a]/20 bg-[#b9fb6a]/10 p-4 text-sm leading-relaxed text-[#b9fb6a]">
          <span className="font-black">Na poti</span> bo iskal črpalke med tvojo lokacijo in ciljem. To dodamo v naslednjem koraku.
        </div>
      )}

      <div className="mt-4 rounded-[26px] border border-white/10 bg-[#123024]/72 p-3 sm:p-4 lg:p-5">
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
            <SelectDark label="Znamke" value={brand} onChange={setBrand} options={BRANDS} />
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced((v: boolean) => !v)}
            className="h-12 rounded-2xl border border-white/10 bg-white/[0.055] px-4 text-left text-sm font-bold text-white/78 transition hover:bg-white/[0.09]"
          >
            {showAdvanced ? 'Skrij filtre' : 'Več filtrov'}
          </button>

          <button
            onClick={search}
            disabled={loading || appMode === 'route'}
            className="h-12 rounded-2xl bg-[#b9fb6a] px-5 text-sm font-black text-[#071a12] shadow-[0_12px_30px_rgba(185,251,106,.22)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 sm:col-span-2"
          >
            {appMode === 'route' ? 'Na poti kmalu' : status === 'location' ? 'Pridobivam lokacijo ...' : status === 'routing' ? 'Računam realne poti ...' : 'Preveri najboljšo izbiro'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniInfo title="Gorivo" text="Cena × količina" />
        <MiniInfo title="Pot" text="Realna vožnja" />
        <MiniInfo title="Čas" text="Privzeto 12 €/h" />
      </div>
    </div>
  )
}

function ResultPanel({
  best,
  otherResults,
  showOthers,
  setShowOthers,
  loading,
  searched,
  status,
  lastUpdated,
  savingVsNearest,
  mapsUrl,
  shareResult,
  shareCopied,
}: any) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(185,251,106,.18),transparent_32%),linear-gradient(180deg,rgba(15,48,34,.86),rgba(5,20,14,.88))] p-4 shadow-[0_25px_80px_rgba(0,0,0,.25)] backdrop-blur-2xl sm:p-6 lg:min-h-[720px] lg:p-8">
      {loading && <LoadingState status={status} />}

      {searched && !loading && status === 'done' && !best && (
        <EmptyState text="V izbranem radiusu trenutno ni realno izračunanih možnosti. Poskusi povečati radius ali prikazati vse znamke." />
      )}

      {searched && !loading && status === 'error' && (
        <EmptyState text="Pri iskanju je prišlo do napake. Poskusi znova." />
      )}

      {!searched && !loading && <ExampleState />}

      {!loading && best && (
        <>
          <BestCard
            item={best}
            savingVsNearest={savingVsNearest}
            mapsUrl={mapsUrl}
            shareResult={shareResult}
            shareCopied={shareCopied}
          />

          {otherResults.length > 0 && (
            <>
              <div className="mt-4 flex items-center justify-between gap-3">
                <h2 className="text-xl font-black tracking-tight">Druge odlične možnosti</h2>
                {lastUpdated && <div className="text-xs text-white/40">Cene {lastUpdated}</div>}
              </div>

              {!showOthers ? (
                <button
                  onClick={() => setShowOthers(true)}
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-sm font-black text-white transition hover:bg-white/[0.1]"
                >
                  Prikaži druge odlične možnosti ({otherResults.length})
                </button>
              ) : (
                <div className="mt-3 space-y-2.5 lg:space-y-3">
                  {otherResults.map((item: Result) => (
                    <CompactResult key={item.location_id} item={item} mapsUrl={mapsUrl} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function BestCard({ item, savingVsNearest, mapsUrl, shareResult, shareCopied }: any) {
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

          {item.recommendation_reason && (
            <div className="mt-3 inline-flex max-w-xl rounded-2xl border border-[#b9fb6a]/20 bg-[#b9fb6a]/12 px-4 py-2 text-sm font-semibold leading-relaxed text-[#b9fb6a]">
              {item.recommendation_reason}
            </div>
          )}
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

        <div className="mt-3 rounded-2xl border border-[#b9fb6a]/70 bg-[#b9fb6a]/12 p-4 text-white shadow-[0_0_0_1px_rgba(185,251,106,.08),0_18px_46px_rgba(185,251,106,.10)]">
          <div className="text-xs font-black uppercase tracking-[.2em] text-[#b9fb6a]/85">Ocenjen skupni strošek</div>
          <div className="mt-1 text-3xl font-black text-[#b9fb6a]">{formatMoney(item.effective_total_cost)}</div>
        </div>
      </div>

      {savingVsNearest > 0.2 && (
        <div className="mt-3 rounded-2xl bg-[#b9fb6a]/14 px-4 py-3 text-sm text-[#b9fb6a]">
          <span className="font-black">Prihranek:</span> približno {savingVsNearest.toFixed(2)} € proti najbližji možnosti.
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
        Izračun je ocena poti do črpalke. Google Maps lahko pokaže drugačen čas zaradi prometa ali prehoda meje.
      </p>
    </div>
  )
}

function CompactResult({ item, mapsUrl }: { item: Result; mapsUrl: (item: Result) => string }) {
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
            <div className="mt-0.5 truncate text-[11px] text-white/40">{item.address}</div>
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
        {status === 'location' ? 'Pridobivam tvojo lokacijo ...' : 'Računam realne poti in strošek tankanja ...'}
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
        Tankaj.si ne primerja samo cene na liter. Upošteva izbran radij, količino goriva, realno vožnjo do črpalke, ocenjeno porabo vozila in čas. Zato je rezultat bolj uporaben kot navaden seznam najcenejših črpalk.
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <MiniInfo title="Formula" text="gorivo + pot + čas" />
        <MiniInfo title="Radius" text="Vedno upoštevamo tvoj izbor" />
        <MiniInfo title="Rezultat" text="1 najboljša izbira + alternative" />
      </div>
    </section>
  )
}

function ModeSwitch({
  appMode,
  setAppMode,
}: {
  appMode: 'nearby' | 'route'
  setAppMode: (value: 'nearby' | 'route') => void
}) {
  return (
    <div className="mt-6 grid grid-cols-2 rounded-[22px] border border-white/10 bg-black/15 p-1">
      <button
        type="button"
        onClick={() => setAppMode('nearby')}
        className={`rounded-[18px] px-4 py-3 text-sm font-black transition ${
          appMode === 'nearby'
            ? 'bg-[#b9fb6a] text-[#071a12] shadow-[0_10px_24px_rgba(185,251,106,.18)]'
            : 'text-white/55 hover:text-white'
        }`}
      >
        Okoli mene
      </button>

      <button
        type="button"
        onClick={() => setAppMode('route')}
        className={`rounded-[18px] px-4 py-3 text-sm font-black transition ${
          appMode === 'route'
            ? 'bg-[#b9fb6a] text-[#071a12] shadow-[0_10px_24px_rgba(185,251,106,.18)]'
            : 'text-white/55 hover:text-white'
        }`}
      >
        Na poti <span className="ml-1 text-[10px] opacity-70">kmalu</span>
      </button>
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