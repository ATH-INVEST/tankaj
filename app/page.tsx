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
  const b = brand.toUpperCase()
  if (b.includes('PETROL')) return 'P'
  if (b.includes('SHELL')) return 'SH'
  if (b.includes('MOL')) return 'MOL'
  if (b.includes('OMV')) return 'OMV'
  if (b.includes('INA')) return 'INA'
  if (b.includes('TIFON')) return 'T'
  if (b.includes('CRODUX')) return 'C'
  return b.slice(0, 3)
}

function brandBadgeClass(brand?: string | null) {
  const b = (brand || '').toUpperCase()
  if (b.includes('PETROL')) return 'bg-[#ed1c24] text-white'
  if (b.includes('MOL')) return 'bg-[#b80f1f] text-white'
  if (b.includes('SHELL')) return 'bg-[#ffd646] text-[#7d1b13]'
  if (b.includes('OMV')) return 'bg-white text-[#02745f] ring-1 ring-black/10'
  if (b.includes('INA')) return 'bg-[#006bb6] text-white'
  if (b.includes('TIFON')) return 'bg-[#1a1a1a] text-white'
  if (b.includes('CRODUX')) return 'bg-[#0057a8] text-white'
  return 'bg-[#10251b] text-white'
}

function formatEur(value: number | string | null | undefined) {
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
  const [visibleCount, setVisibleCount] = useState(4)

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

  const featuredAlternatives = useMemo(() => {
    const added = new Set<string>()
    const items: { item: Result; label?: string }[] = []

    function add(item?: Result | null, label?: string) {
      if (!item || !best || item.location_id === best.location_id || added.has(item.location_id)) return
      added.add(item.location_id)
      items.push({ item, label })
    }

    add(preferredPick, 'Preferirana znamka')
    add(crossBorder, 'Čez mejo')
    add(nearest, 'Najbližje')

    for (const item of results) {
      if (items.length >= visibleCount) break
      add(item)
    }

    return items
  }, [best, preferredPick, crossBorder, nearest, results, visibleCount])

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
    setVisibleCount(4)

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
    const text = saving > 0.2
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

  function HeroResultCard({ item }: { item: Result }) {
    const saving = Number(summary?.saving_vs_nearest || 0)

    return (
      <div className="rounded-[30px] bg-white p-4 shadow-[0_18px_55px_rgba(16,37,27,.10)] ring-1 ring-black/5 sm:p-5 lg:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[.22em] text-[#0f6b46]">Najboljša izbira</div>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#10251b] sm:text-3xl">{item.name}</h2>
            <p className="mt-1 line-clamp-1 text-sm text-[#6a7872]">
              {item.address}{item.city ? `, ${item.city}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#eef5f0] px-2.5 py-1 text-xs font-bold text-[#607067]">{item.country_code || 'SI'}</span>
            {item.is_cross_border && <span className="rounded-full bg-[#B9FB6A] px-2.5 py-1 text-xs font-bold text-[#17311e]">čez mejo</span>}
          </div>
        </div>

        <div className="mt-5 rounded-[24px] bg-[#f3f8f4] p-4 ring-1 ring-black/5">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4">
            <div className={`flex h-13 w-13 items-center justify-center rounded-2xl text-sm font-black ${brandBadgeClass(item.brand)}`}>{brandShort(item.brand)}</div>
            <div>
              <div className="text-xs font-medium text-[#6a7872]">Cena goriva</div>
              <div className="text-3xl font-black tracking-tight text-[#0f6b46]">{item.price.toFixed(3)} €/L</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-[#6a7872]">Vožnja</div>
              <div className="font-black text-[#10251b]">{item.distance_km} km</div>
              <div className="text-xs text-[#6a7872]">~{item.estimated_drive_minutes} min</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <MiniMetric label="Gorivo" value={formatEur(item.fuel_cost)} />
            <MiniMetric label="Pot" value={formatEur(item.travel_fuel_cost)} />
            <MiniMetric label="Čas" value={formatEur(item.time_cost)} />
          </div>

          <div className="mt-3 rounded-2xl bg-[#B9FB6A] p-4 text-[#10251b]">
            <div className="text-[11px] font-black uppercase tracking-[.18em] opacity-70">Končni strošek</div>
            <div className="mt-1 text-4xl font-black tracking-tight">{formatEur(item.effective_total_cost)}</div>
          </div>
        </div>

        {saving > 0.2 && (
          <div className="mt-3 rounded-2xl bg-[#efffe1] px-4 py-3 text-sm font-semibold text-[#0d6b43]">
            Prihranek približno {saving.toFixed(2)} € proti najbližji možnosti.
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <a href={mapsUrl(item)} target="_blank" rel="noopener noreferrer" className="rounded-2xl bg-[#10251b] px-5 py-3 text-center font-black text-white">Navigacija</a>
          <button onClick={shareResult} className="rounded-2xl bg-white px-5 py-3 font-black text-[#10251b] ring-1 ring-black/10">{shareCopied ? 'Kopirano ✓' : 'Deli'}</button>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-[#8a9791]">Izračun je ocena. Google Maps lahko pokaže drugačen čas zaradi prometa ali prehoda meje.</p>
      </div>
    )
  }

  function ResultRow({ item, label }: { item: Result; label?: string }) {
    return (
      <a href={mapsUrl(item)} target="_blank" rel="noopener noreferrer" className="block rounded-[22px] bg-white p-3.5 shadow-[0_10px_35px_rgba(16,37,27,.06)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_16px_45px_rgba(16,37,27,.10)]">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xs font-black ${brandBadgeClass(item.brand)}`}>{brandShort(item.brand)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate font-black text-[#10251b]">{item.name}</div>
              {label && <span className="shrink-0 rounded-full bg-[#eef5f0] px-2 py-0.5 text-[10px] font-bold text-[#607067]">{label}</span>}
            </div>
            <div className="mt-0.5 truncate text-xs text-[#6a7872]">{item.address}</div>
            <div className="mt-1 text-xl font-black text-[#0f6b46]">{item.price.toFixed(3)} €/L</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-black text-[#10251b]">{item.distance_km} km</div>
            <div className="text-xs text-[#6a7872]">~{item.estimated_drive_minutes} min</div>
            <div className="mt-1 text-[10px] text-[#6a7872]">skupaj</div>
            <div className="font-black text-[#0f6b46]">{formatEur(item.effective_total_cost)}</div>
          </div>
        </div>
      </a>
    )
  }

  return (
    <main className="min-h-screen bg-[#f6f8f4] text-[#10251b]">
      <div className="pointer-events-none fixed inset-0 -z-0 bg-[radial-gradient(circle_at_15%_10%,rgba(185,251,106,.35),transparent_28%),radial-gradient(circle_at_92%_15%,rgba(15,107,70,.14),transparent_30%)]" />

      <section className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col px-4 py-4 sm:px-5 lg:min-h-screen lg:py-6">
        <div className="grid flex-1 items-stretch gap-4 lg:grid-cols-[.93fr_1.07fr]">
          <div className="rounded-[30px] bg-white/88 p-5 shadow-[0_18px_65px_rgba(16,37,27,.08)] ring-1 ring-black/5 backdrop-blur sm:p-6 lg:p-7">
            <div className="flex items-center justify-between gap-4">
              <div className="text-3xl font-black italic tracking-tight sm:text-4xl">
                Tankaj<span className="text-[#86d83a]">.si</span>
              </div>
              <div className="rounded-full bg-[#e9fbda] px-3 py-1 text-xs font-black text-[#0f6b46]">BETA</div>
            </div>

            <div className="mt-5 flex items-center gap-2 text-sm font-medium text-[#607067]">
              <span className="text-[#86d83a]">⌖</span>
              <span>Slovenija + Hrvaška</span>
            </div>

            <h1 className="mt-6 max-w-lg text-[48px] font-black leading-[.92] tracking-[-.055em] text-[#10251b] sm:text-[62px] lg:text-[72px] xl:text-[78px]">
              Ne tankaj več na pamet.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-[#607067] sm:text-lg">
              Tankaj.si izračuna najboljšo izbiro glede na ceno goriva, razdaljo, strošek poti, čas in tvoje preference.
            </p>

            <div id="kalkulator" className="mt-5 rounded-[28px] bg-[#f1f6f2] p-4 ring-1 ring-black/5 lg:p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectLight label="Gorivo" value={fuelType} onChange={setFuelType} options={[["PETROL_95", "Bencin 95"], ["DIESEL", "Dizel"]]} />
                <SelectLight label="Radius" value={String(radius)} onChange={(v) => setRadius(Number(v))} options={[["5", "5 km"], ["10", "10 km"], ["25", "25 km"], ["50", "50 km"], ["100", "100 km"], ["200", "200 km"]]} />

                <label>
                  <span className="mb-1.5 block text-xs font-semibold text-[#6a7872]">Količina</span>
                  <input value={amount} onChange={(e) => setAmount(Number(e.target.value))} type="number" className="h-12 w-full rounded-2xl border border-black/8 bg-white px-4 text-[15px] font-semibold text-[#10251b] outline-none transition focus:border-[#86d83a] focus:ring-4 focus:ring-[#B9FB6A]/25" />
                </label>

                <SelectLight label="Prikaži znamke" value={brand} onChange={setBrand} options={BRANDS} />
                <SelectLight label="Preferirana znamka" value={preferredBrand} onChange={setPreferredBrand} options={[["NONE", "Brez preference"], ...BRANDS.filter(([v]) => v !== 'ALL')]} />
                <SelectLight label="Način poti" value={tripMode} onChange={setTripMode} options={[["return", "Grem samo tankat"], ["oneway", "Je spotoma / grem v to smer"]]} />
                <SelectLight label="Razvrsti po" value={sortBy} onChange={setSortBy} options={[["smart", "Najboljša izbira"], ["total", "Najnižji skupni strošek"], ["price", "Najnižja cena €/L"], ["distance", "Najbližje"]]} />

                <button onClick={search} disabled={loading} className="h-12 rounded-2xl bg-[#B9FB6A] px-5 text-[15px] font-black text-[#10251b] shadow-[0_12px_28px_rgba(124,214,55,.24)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 sm:self-end">
                  {status === 'location' ? 'Pridobivam lokacijo ...' : status === 'routing' ? 'Računam izbiro ...' : 'Preveri najboljšo izbiro'}
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <InfoTile title="Gorivo" text="Cena × količina." />
              <InfoTile title="Pot" text="Realna vožnja." />
              <InfoTile title="Čas" text="Privzeto 6 €/h." />
            </div>
          </div>

          <div className="rounded-[30px] bg-[#edf4ed] p-4 shadow-[0_18px_65px_rgba(16,37,27,.08)] ring-1 ring-black/5 sm:p-5 lg:flex lg:min-h-0 lg:flex-col lg:p-6">
            {!searched && !loading && (
              <div className="flex h-full min-h-[360px] flex-col justify-center rounded-[28px] bg-white p-6 ring-1 ring-black/5 lg:min-h-0">
                <div className="text-xs font-bold uppercase tracking-[.18em] text-[#0f6b46]">Primer logike</div>
                <h2 className="mt-3 max-w-lg text-3xl font-black tracking-tight text-[#10251b] sm:text-4xl">Najnižja cena na liter ni vedno najboljša izbira.</h2>
                <div className="mt-6 grid gap-3">
                  <ExampleLine label="Črpalka A" value="1.605 €/L · 5 km stran" />
                  <ExampleLine label="Črpalka B" value="1.589 €/L · 28 km stran" />
                  <div className="rounded-2xl bg-[#B9FB6A] p-4 text-[#10251b]">
                    <div className="text-xs font-semibold opacity-70">Tankaj.si preveri razliko</div>
                    <div className="mt-1 text-xl font-black">manj vožnje je lahko cenejše kot nižja cena</div>
                  </div>
                </div>
              </div>
            )}

            {loading && (
              <div className="rounded-[28px] bg-white p-5 ring-1 ring-black/5">
                <div className="text-sm font-semibold text-[#607067]">{status === 'location' ? 'Pridobivam tvojo lokacijo ...' : 'Primerjam črpalke, cene in strošek poti ...'}</div>
                <div className="mt-5 h-10 w-64 animate-pulse rounded-full bg-black/10" />
                <div className="mt-6 space-y-3">
                  <div className="h-36 animate-pulse rounded-3xl bg-black/10" />
                  <div className="h-20 animate-pulse rounded-3xl bg-black/10" />
                  <div className="h-20 animate-pulse rounded-3xl bg-black/10" />
                </div>
              </div>
            )}

            {searched && !loading && status === 'error' && (
              <div className="rounded-[28px] bg-white p-6 text-[#607067] ring-1 ring-black/5">Pri iskanju je prišlo do napake. Poskusi znova.</div>
            )}

            {searched && !loading && status === 'done' && results.length === 0 && (
              <div className="rounded-[28px] bg-white p-6 text-[#607067] ring-1 ring-black/5">V izbranem radiusu trenutno ni zadetkov. Poskusi povečati radius ali prikazati vse znamke.</div>
            )}

            {!loading && best && (
              <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
                <HeroResultCard item={best} />

                <div className="mt-4 flex items-center justify-between gap-3">
                  <h3 className="text-xl font-black tracking-tight text-[#10251b]">Druge odlične možnosti</h3>
                  {lastUpdated && <span className="text-xs font-medium text-[#6a7872]">Cene {lastUpdated}</span>}
                </div>

                <div className="mt-3 grid gap-2.5 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
                  {featuredAlternatives.map(({ item, label }) => <ResultRow key={`${item.location_id}-${label || 'r'}`} item={item} label={label} />)}
                </div>

                {results.length > visibleCount && (
                  <div className="mt-4 flex justify-center">
                    <button onClick={() => setVisibleCount((v) => v + 4)} className="rounded-2xl bg-white px-6 py-3 font-black text-[#10251b] shadow-sm ring-1 ring-black/5 hover:bg-[#f8faf8]">Naloži več rezultatov</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <section className="mt-5 rounded-[30px] bg-white p-6 shadow-[0_18px_65px_rgba(16,37,27,.06)] ring-1 ring-black/5 sm:p-7 lg:mt-6">
          <h2 className="text-3xl font-black tracking-tight text-[#10251b]">Kako deluje?</h2>
          <p className="mt-3 max-w-4xl text-base leading-relaxed text-[#607067]">
            Tankaj.si ne primerja samo cene na liter, ampak izračuna približen skupni strošek tankanja. Upoštevamo ceno goriva, količino, ocenjeno realno vožnjo do črpalke, povprečno porabo vozila 7 L/100 km in ocenjeno vrednost časa 6 €/h.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <InfoTile title="Formula" text="gorivo + pot + čas = končni strošek" />
            <InfoTile title="Način poti" text="Računaš tja in nazaj ali kot spotoma." />
            <InfoTile title="Cilj" text="Optimiziramo odločitev, ne samo cene." />
          </div>
        </section>
      </section>
    </main>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-black/5">
      <div className="text-[10px] font-black uppercase tracking-[.14em] text-[#8a9791]">{label}</div>
      <div className="mt-1 font-black text-[#10251b]">{value}</div>
    </div>
  )
}

function InfoTile({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl bg-[#f3f8f4] p-4 ring-1 ring-black/5">
      <div className="font-black text-[#10251b]">{title}</div>
      <div className="mt-1 text-sm leading-relaxed text-[#607067]">{text}</div>
    </div>
  )
}

function ExampleLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#f3f8f4] p-4 ring-1 ring-black/5">
      <div className="text-xs font-semibold text-[#6a7872]">{label}</div>
      <div className="mt-1 text-xl font-black text-[#0f6b46]">{value}</div>
    </div>
  )
}

function SelectLight({
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
      <span className="mb-1.5 block text-xs font-semibold text-[#6a7872]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-12 w-full appearance-none rounded-2xl border border-black/8 bg-white bg-[linear-gradient(45deg,transparent_50%,#607067_50%),linear-gradient(135deg,#607067_50%,transparent_50%)] bg-[length:5px_5px,5px_5px] bg-[position:calc(100%-18px)_20px,calc(100%-13px)_20px] bg-no-repeat px-4 pr-9 text-[15px] font-semibold text-[#10251b] outline-none transition focus:border-[#86d83a] focus:ring-4 focus:ring-[#B9FB6A]/25">
        {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
  )
}
