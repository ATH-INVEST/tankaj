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

const FUEL_OPTIONS = [
  ['PETROL_95', 'Bencin 95'],
  ['DIESEL', 'Dizel'],
]

const RADIUS_OPTIONS = [
  ['5', '5 km'],
  ['10', '10 km'],
  ['25', '25 km'],
  ['50', '50 km'],
  ['100', '100 km'],
  ['200', '200 km'],
]

const TRIP_OPTIONS = [
  ['return', 'Grem samo tankat'],
  ['oneway', 'Je spotoma'],
]

const SORT_OPTIONS = [
  ['smart', 'Najboljša izbira'],
  ['total', 'Najnižji skupni strošek'],
  ['price', 'Najnižja cena €/L'],
  ['distance', 'Najbližje'],
]

function brandShort(brand?: string | null) {
  if (!brand) return 'BS'
  const b = brand.toUpperCase()
  if (b.includes('PETROL')) return 'P'
  if (b.includes('MOL')) return 'MOL'
  if (b.includes('SHELL')) return 'SH'
  if (b.includes('OMV')) return 'OMV'
  if (b.includes('INA')) return 'INA'
  if (b.includes('TIFON')) return 'TF'
  return b.slice(0, 3)
}

function brandBadgeClass(brand?: string | null) {
  const b = (brand || '').toUpperCase()
  if (b.includes('PETROL')) return 'bg-[#e31b23] text-white'
  if (b.includes('MOL')) return 'bg-[#b01222] text-white'
  if (b.includes('SHELL')) return 'bg-[#ffd83d] text-[#b01222]'
  if (b.includes('OMV')) return 'bg-white text-[#00856f]'
  if (b.includes('INA')) return 'bg-[#005baa] text-white'
  if (b.includes('TIFON')) return 'bg-[#f37021] text-white'
  return 'bg-white text-[#10251b]'
}

function formatMoney(value?: number | null) {
  return `${Number(value || 0).toFixed(2)} €`
}

export default function Home() {
  const [fuelType, setFuelType] = useState('PETROL_95')
  const [radius, setRadius] = useState(50)
  const [amount, setAmount] = useState(50)
  const [brand, setBrand] = useState('ALL')
  const [preferredBrand, setPreferredBrand] = useState('NONE')
  const [tripMode, setTripMode] = useState('return')
  const [sortBy, setSortBy] = useState('smart')
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

          setTimeout(() => {
            document.getElementById('rezultat')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }, 100)
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
      <div id="rezultat" className="scroll-mt-5 overflow-hidden rounded-[30px] border border-[#b9fb6a]/30 bg-[linear-gradient(180deg,rgba(20,52,36,.96),rgba(7,24,16,.98))] p-4 text-white shadow-[0_28px_90px_rgba(0,0,0,.35)] sm:rounded-[34px] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[.18em] text-[#b9fb6a]">Najboljša izbira</div>
            <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-4xl">{item.name}</h2>
          </div>
          <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/70">
            {item.country_code || 'SI'}{item.is_cross_border ? ' · čez mejo' : ''}
          </div>
        </div>

        <div className="mt-3 text-sm text-white/55 sm:text-base">
          {item.address}{item.city ? `, ${item.city}` : ''}
        </div>

        <div className="mt-5 rounded-[26px] border border-white/10 bg-white/[0.07] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xs font-black shadow-sm ${brandBadgeClass(item.brand)}`}>
                {brandShort(item.brand)}
              </div>
              <div>
                <div className="text-sm text-white/45">Cena goriva</div>
                <div className="text-3xl font-black text-[#b9fb6a] sm:text-4xl">{item.price.toFixed(3)} €/L</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-white/45">Vožnja</div>
              <div className="text-lg font-bold">{item.distance_km} km</div>
              <div className="text-xs text-white/45">~{item.estimated_drive_minutes} min</div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <MiniMetric label="Gorivo" value={formatMoney(item.fuel_cost)} />
            <MiniMetric label="Pot" value={formatMoney(item.travel_fuel_cost)} />
            <MiniMetric label="Čas" value={formatMoney(item.time_cost)} />
          </div>

          <div className="mt-3 rounded-2xl bg-[#b9fb6a] p-4 text-[#10251b]">
            <div className="text-xs font-semibold uppercase tracking-[.14em] opacity-70">Končni strošek</div>
            <div className="mt-1 text-3xl font-black">{formatMoney(item.effective_total_cost)}</div>
          </div>
        </div>

        {saving > 0.2 && (
          <div className="mt-4 rounded-2xl border border-[#b9fb6a]/20 bg-[#b9fb6a]/12 px-4 py-3 text-[#b9fb6a]">
            <span className="font-bold">Prihranek:</span> približno {saving.toFixed(2)} € proti najbližji možnosti.
          </div>
        )}

        <div className="mt-5 flex gap-3">
          <a href={mapsUrl(item)} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-2xl bg-white px-4 py-3 text-center font-bold text-[#10251b]">
            Navigacija
          </a>
          <button onClick={shareResult} className="flex-1 rounded-2xl border border-white/15 px-4 py-3 font-bold text-white hover:bg-white/10">
            {shareCopied ? 'Kopirano ✓' : 'Deli'}
          </button>
        </div>

        <div className="mt-4 text-xs leading-relaxed text-white/38">
          Izračun je ocena. Google Maps lahko pokaže drugačen čas zaradi prometa ali prehoda meje.
        </div>
      </div>
    )
  }

  function CompactResult({ item, label }: { item: Result; label?: string }) {
    return (
      <a href={mapsUrl(item)} target="_blank" rel="noopener noreferrer" className="block rounded-[24px] border border-white/10 bg-white/[0.06] p-4 text-white transition hover:bg-white/[0.09]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xs font-black ${brandBadgeClass(item.brand)}`}>
              {brandShort(item.brand)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-bold sm:text-lg">
                {item.name}
                {item.is_preferred_brand && <span className="ml-2 rounded-full bg-[#b9fb6a]/20 px-2 py-1 text-[10px] text-[#b9fb6a]">preferirana</span>}
              </div>
              <div className="mt-1 truncate text-xs text-white/42">{label || item.address}</div>
              <div className="mt-2 text-xl font-black text-[#b9fb6a]">{item.price.toFixed(3)} €/L</div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-bold text-white/85">{item.distance_km} km</div>
            <div className="mt-1 text-xs text-white/42">~{item.estimated_drive_minutes} min</div>
            <div className="mt-2 text-xs text-white/42">skupaj</div>
            <div className="font-black text-[#b9fb6a]">{formatMoney(item.effective_total_cost)}</div>
          </div>
        </div>
      </a>
    )
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#06170f] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(185,251,106,.13),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(45,135,82,.18),transparent_30%)]" />

      <section className="relative mx-auto max-w-6xl px-4 pb-10 pt-5 sm:px-6 sm:py-10">
        <div className="grid gap-5 lg:grid-cols-[.95fr_1.05fr] lg:items-stretch">
          <div className="rounded-[32px] border border-white/10 bg-[#0b2117]/92 p-5 shadow-[0_30px_100px_rgba(0,0,0,.34)] backdrop-blur sm:rounded-[38px] sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <div className="text-3xl font-black italic tracking-tight sm:text-4xl">
                Tankaj<span className="text-[#b9fb6a]">.si</span>
              </div>
              <div className="rounded-full bg-[#b9fb6a]/18 px-4 py-2 text-sm font-bold text-[#b9fb6a]">BETA</div>
            </div>

            <div className="mt-6 flex items-center gap-2 text-base text-white/58 sm:text-lg">
              <span className="text-[#b9fb6a]">⌖</span>
              <span>Slovenija + Hrvaška</span>
            </div>

            <h1 className="mt-8 text-[clamp(3.6rem,11vw,5.9rem)] font-black leading-[.95] tracking-[-.055em]">
              Ne tankaj več na pamet.
            </h1>

            <p className="mt-6 max-w-2xl text-[1.15rem] leading-relaxed text-white/58 sm:text-xl">
              Tankaj.si izračuna najboljšo izbiro glede na ceno goriva, razdaljo, strošek poti, čas in tvoje preference.
            </p>

            <div id="kalkulator" className="mt-7 rounded-[30px] border border-white/10 bg-white/[0.06] p-4 sm:p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectDark label="Gorivo" value={fuelType} onChange={setFuelType} options={FUEL_OPTIONS} />
                <SelectDark label="Radius" value={String(radius)} onChange={(v) => setRadius(Number(v))} options={RADIUS_OPTIONS} />

                <label>
                  <span className="mb-2 block text-sm font-medium text-white/52">Količina</span>
                  <input value={amount} onChange={(e) => setAmount(Number(e.target.value))} type="number" className="h-[54px] w-full rounded-2xl border border-white/12 bg-[#0b2016] px-4 text-[17px] text-white outline-none ring-0 placeholder:text-white/30 focus:border-[#b9fb6a]/70" />
                </label>

                <SelectDark label="Prikaži znamke" value={brand} onChange={setBrand} options={BRANDS} />
                <SelectDark label="Preferirana znamka" value={preferredBrand} onChange={setPreferredBrand} options={[['NONE', 'Brez preference'], ...BRANDS.filter(([v]) => v !== 'ALL')]} />
                <SelectDark label="Način poti" value={tripMode} onChange={setTripMode} options={TRIP_OPTIONS} />
                <SelectDark label="Razvrsti po" value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />

                <button onClick={search} disabled={loading} className="h-[58px] rounded-2xl bg-[#b9fb6a] px-5 text-[17px] font-black leading-tight text-[#10251b] shadow-[0_14px_34px_rgba(185,251,106,.2)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 sm:mt-7">
                  {status === 'location' ? 'Pridobivam lokacijo ...' : status === 'routing' ? 'Računam izbiro ...' : 'Preveri najboljšo izbiro'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <InfoDark title="Gorivo" text="Cena × količina." />
              <InfoDark title="Pot" text="Vožnja do črpalke." />
              <InfoDark title="Čas" text="Privzeto 6 €/h." />
            </div>
          </div>

          <div className="rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(185,251,106,.18),transparent_36%),linear-gradient(180deg,#11351f,#071a12)] p-5 shadow-[0_30px_100px_rgba(0,0,0,.34)] sm:rounded-[38px] sm:p-7">
            {loading && (
              <div className="rounded-[30px] border border-white/10 bg-white/[0.06] p-5">
                <div className="text-sm text-white/55">{status === 'location' ? 'Pridobivam tvojo lokacijo ...' : 'Primerjam črpalke, cene in strošek poti ...'}</div>
                <div className="mt-5 h-10 w-64 animate-pulse rounded-full bg-white/10" />
                <div className="mt-6 space-y-3">
                  <div className="h-44 animate-pulse rounded-3xl bg-white/10" />
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
              <div className="flex min-h-[520px] flex-col justify-center">
                <div className="text-sm text-white/42">Primer logike</div>
                <div className="mt-3 max-w-xl text-3xl font-black leading-tight tracking-tight sm:text-4xl">
                  Najnižja cena na liter ni vedno najboljša izbira.
                </div>
                <div className="mt-7 space-y-3">
                  <ExampleLine label="Črpalka A" value="1.605 €/L · 5 km stran" />
                  <ExampleLine label="Črpalka B" value="1.589 €/L · 28 km stran" />
                  <div className="rounded-3xl bg-[#b9fb6a] p-5 text-[#10251b]">
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
                  {preferredPick && preferredPick.location_id !== best.location_id && <CompactResult item={preferredPick} label="Najboljša preferirana znamka" />}
                  {crossBorder && crossBorder.location_id !== best.location_id && <CompactResult item={crossBorder} label="Najboljša izbira čez mejo" />}
                  {nearest && nearest.location_id !== best.location_id && <CompactResult item={nearest} label="Najbližja možnost" />}
                  {visibleResults.filter((item) => item.location_id !== best.location_id).map((item) => <CompactResult key={item.location_id} item={item} />)}
                </div>

                {lastUpdated && <div className="mt-4 text-sm text-white/40">Cene so bile nazadnje posodobljene {lastUpdated}.</div>}

                {results.length > visibleCount && (
                  <div className="mt-5 flex justify-center">
                    <button onClick={() => setVisibleCount((v) => v + 5)} className="rounded-2xl border border-white/10 bg-white/[0.06] px-6 py-4 font-semibold text-white hover:bg-white/[0.09]">
                      Naloži več rezultatov
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <section className="mt-6 rounded-[32px] border border-white/10 bg-white/[0.04] p-5 text-white sm:mt-8 sm:rounded-[38px] sm:p-8">
          <h2 className="text-3xl font-black tracking-tight">Kako deluje?</h2>
          <p className="mt-4 max-w-4xl text-base leading-relaxed text-white/58 sm:text-lg">
            Tankaj.si ne primerja samo cene na liter, ampak izračuna približen skupni strošek tankanja. Upoštevamo ceno goriva, količino, ocenjeno realno vožnjo do črpalke, povprečno porabo vozila 7 L/100 km in ocenjeno vrednost časa 6 €/h.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <InfoDark title="Formula" text="gorivo + pot + čas = končni strošek" />
            <InfoDark title="Način poti" text="Računaš tja in nazaj ali kot spotoma." />
            <InfoDark title="Cilj" text="Optimiziramo odločitev, ne samo cene." />
          </div>
        </section>
      </section>
    </main>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-3">
      <div className="text-[11px] uppercase tracking-[.12em] text-white/40">{label}</div>
      <div className="mt-1 text-base font-black sm:text-lg">{value}</div>
    </div>
  )
}

function ExampleLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-white/[0.075] p-5 shadow-inner">
      <div className="text-sm text-white/42">{label}</div>
      <div className="mt-1 text-2xl font-black text-[#b9fb6a]">{value}</div>
    </div>
  )
}

function InfoDark({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4">
      <div className="font-bold text-white">{title}</div>
      <div className="mt-1 text-sm leading-relaxed text-white/48">{text}</div>
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
      <span className="mb-2 block text-sm font-medium text-white/52">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-[54px] w-full appearance-none rounded-2xl border border-white/12 bg-[#0b2016] px-4 pr-11 text-[17px] text-white outline-none ring-0 focus:border-[#b9fb6a]/70"
        >
          {options.map(([value, label]) => (
            <option key={value} value={value} className="bg-[#10251b] text-white">
              {label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/42">⌄</span>
      </div>
    </label>
  )
}
