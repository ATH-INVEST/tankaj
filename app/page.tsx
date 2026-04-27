'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trackEvent } from '@/lib/analytics'

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
type SortBy = 'smart' | 'price' | 'distance'

const BRANDS = [
  ['ALL', 'Vse znamke'],
  ['PETROL', 'Petrol'],
  ['MOL', 'MOL'],
  ['SHELL', 'Shell'],
  ['OMV', 'OMV'],
  ['TURMÖL', 'Turmöl'],
  ['JET', 'JET'],
  ['AVIA', 'Avia'],
  ['MAXEN', 'Maxen'],
  ['INA', 'INA'],
  ['TIFON', 'Tifon'],
  ['CRODUX', 'Crodux'],
  ['ENI', 'Eni'],
  ['Q8', 'Q8'],
  ['IP', 'IP'],
  ['TAMOIL', 'Tamoil'],
  ['ESSO', 'Esso'],
  ['TOTALENERGIES', 'TotalEnergies'],
]
const sortOptions: [SortBy, string][] = [
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
  if (b.includes('ENI')) return 'ENI'
  if (b.includes('Q8')) return 'Q8'
  if (b.includes('IP')) return 'IP'
  if (b.includes('TAMOIL')) return 'TA'
  if (b.includes('ESSO')) return 'ES'
  if (b.includes('TOTAL')) return 'TE'
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
  if (b.includes('ENI') || b.includes('AGIP')) return 'bg-[#ffd100] text-[#111]'
  if (b.includes('Q8')) return 'bg-[#005baa] text-white'
  if (b.includes('IP')) return 'bg-[#1f4bff] text-white'
  if (b.includes('TAMOIL')) return 'bg-[#0050a4] text-white'
  if (b.includes('ESSO')) return 'bg-[#e1251b] text-white'
  if (b.includes('TOTAL')) return 'bg-[#ed1b2f] text-white'
  return 'bg-white/90 text-[#0b1f16]'
}

function formatMoney(value?: number | null) {
  return `${Number(value || 0).toFixed(2)} €`
}

function formatKm(value?: number | null) {
  return `${Number(value || 0).toFixed(2).replace('.00', '')} km`
}

function countryLabel(code?: string | null) {
  if (!code) return '—'
  return code.toUpperCase()
}

function normalizeFilterValue(value?: string | null) {
  return String(value || '').trim().toUpperCase()
}

function brandMatches(rowBrand: string | null | undefined, selectedBrand: string) {
  const selected = normalizeFilterValue(selectedBrand)
  if (!selected || selected === 'ALL') return true

  const row = normalizeFilterValue(rowBrand)
  if (!row) return false
  if (row === selected) return true

  return row.includes(selected) || selected.includes(row)
}

function stationBrandMatches(item: Result, selectedBrand: string) {
  const selected = normalizeFilterValue(selectedBrand)
  if (!selected || selected === 'ALL') return true

  const brand = normalizeFilterValue(item.brand)
  const name = normalizeFilterValue(item.name)

  if (brand && (brand === selected || brand.includes(selected) || selected.includes(brand))) {
    return true
  }

  return Boolean(name && name.includes(selected))
}

function inferBrandKey(item: Pick<Result, 'brand' | 'name'>) {
  const brand = normalizeFilterValue(item.brand)
  const name = normalizeFilterValue(item.name)
  const source = `${brand} ${name}`

  const known = [
    'PETROL',
    'MOL',
    'SHELL',
    'OMV',
    'TURMÖL',
    'TURMOEL',
    'JET',
    'AVIA',
    'MAXEN',
    'INA',
    'TIFON',
    'CRODUX',
    'ENI',
    'Q8',
    'IP',
    'TAMOIL',
    'ESSO',
    'TOTALENERGIES',
  ]

  const match = known.find((value) => source.includes(value))
  if (!match) return brand || ''
  if (match === 'TURMOEL') return 'TURMÖL'
  return match
}

function brandLabel(value: string) {
  const key = normalizeFilterValue(value)
  const labels: Record<string, string> = {
    PETROL: 'Petrol',
    MOL: 'MOL',
    SHELL: 'Shell',
    OMV: 'OMV',
    TURMÖL: 'Turmöl',
    TURMOEL: 'Turmöl',
    JET: 'JET',
    AVIA: 'Avia',
    MAXEN: 'Maxen',
    INA: 'INA',
    TIFON: 'Tifon',
    CRODUX: 'Crodux',
    ENI: 'Eni',
    Q8: 'Q8',
    IP: 'IP',
    TAMOIL: 'Tamoil',
    ESSO: 'Esso',
    TOTALENERGIES: 'TotalEnergies',
  }

  return labels[key] || value
}

function scoreItem(
  item: Result,
  includeFuel: boolean,
  includePath: boolean,
  includeTime: boolean
) {
  const fuel = includeFuel ? Number(item.fuel_cost || 0) : 0
  const path = includePath ? Number(item.travel_fuel_cost || 0) : 0
  const time = includeTime ? Number(item.time_cost || 0) : 0
  return Number((fuel + path + time).toFixed(2))
}

function sortClientResults(
  rows: Result[],
  sortBy: SortBy,
  includeFuel: boolean,
  includePath: boolean,
  includeTime: boolean
) {
  return [...rows].sort((a, b) => {
    const aScore = scoreItem(a, includeFuel, includePath, includeTime)
    const bScore = scoreItem(b, includeFuel, includePath, includeTime)

    if (sortBy === 'price') {
      if (a.price !== b.price) return a.price - b.price
      if (a.distance_km !== b.distance_km) return a.distance_km - b.distance_km
      return aScore - bScore
    }

    if (sortBy === 'distance') {
      if (a.distance_km !== b.distance_km) return a.distance_km - b.distance_km
      if (a.price !== b.price) return a.price - b.price
      return aScore - bScore
    }

    if (aScore !== bScore) return aScore - bScore
    return a.distance_km - b.distance_km
  })
}

function reasonBySort(sortBy: SortBy) {
  if (sortBy === 'price') return 'Najcenejša cena na liter v izbranem radiusu.'
  if (sortBy === 'distance') return 'Najbližja črpalka po realni cestni poti.'
  return 'Najboljša kombinacija izbranih stroškov.'
}

function buildCrossBorderInsight(
  results: Result[],
  best: Result | null,
  includeFuel: boolean,
  includePath: boolean,
  includeTime: boolean
) {
  if (!best || !best.country_code) return null

  const homeCountry = results.find((r) => !r.is_cross_border)?.country_code || 'SI'
  const homeOptions = results.filter((r) => r.country_code === homeCountry)
  const crossBorderOptions = results.filter((r) => r.country_code && r.country_code !== homeCountry)

  if (!homeOptions.length || !crossBorderOptions.length) return null

  const bestHome = [...homeOptions].sort(
    (a, b) => scoreItem(a, includeFuel, includePath, includeTime) - scoreItem(b, includeFuel, includePath, includeTime)
  )[0]

  const bestCross = [...crossBorderOptions].sort(
    (a, b) => scoreItem(a, includeFuel, includePath, includeTime) - scoreItem(b, includeFuel, includePath, includeTime)
  )[0]

  if (!bestHome || !bestCross) return null

  const saving = Number(
    (scoreItem(bestHome, includeFuel, includePath, includeTime) - scoreItem(bestCross, includeFuel, includePath, includeTime)).toFixed(2)
  )

  return {
    saving,
    homeCountry,
    crossCountry: bestCross.country_code,
    station: bestCross,
    isWorthIt: saving > 1,
  }
}

export default function Home() {
  const [fuelType, setFuelType] = useState('PETROL_95')
  const [radius, setRadius] = useState(25)
  const [amount, setAmount] = useState(50)
  const [brand, setBrand] = useState('ALL')
  const [country, setCountry] = useState('ALL')
  const [sortBy, setSortBy] = useState<SortBy>('smart')
  const [appMode, setAppMode] = useState<'nearby' | 'route'>('nearby')
  const [showOthers, setShowOthers] = useState(false)

  const [includeFuel, setIncludeFuel] = useState(true)
  const [includePath, setIncludePath] = useState(true)
  const [includeTime, setIncludeTime] = useState(true)

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [searched, setSearched] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

 const activeRequestId = useRef(0)
 const abortRef = useRef<AbortController | null>(null)
 const didAutoLocate = useRef(false)

  const [nextOffset, setNextOffset] = useState(6)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const loading = status === 'location' || status === 'routing'

  const brandOptions = useMemo(() => {
    if (!results.length) return [['ALL', 'Vse znamke']]

    const available = new Map<string, string>()

    for (const item of results) {
      const key = inferBrandKey(item)
      if (!key) continue
      available.set(key, brandLabel(key))
    }

    return [
      ['ALL', 'Vse znamke'],
      ...Array.from(available.entries()).sort((a, b) => a[1].localeCompare(b[1])),
    ]
  }, [results])


  useEffect(() => {
    if (brand === 'ALL') return
    if (brandOptions.some(([value]) => value === brand)) return
    setBrand('ALL')
  }, [brand, brandOptions])

  const filteredResults = useMemo(() => {
    return results.filter((item) => stationBrandMatches(item, brand))
  }, [results, brand])


  const sortedResults = useMemo(() => {
    return sortClientResults(filteredResults, sortBy, includeFuel, includePath, includeTime)
  }, [filteredResults, sortBy, includeFuel, includePath, includeTime])

  const best = sortedResults[0] || null

  const otherResults = useMemo(() => {
    const unique = new Map<string, Result>()
    for (const item of sortedResults) {
      if (best?.location_id === item.location_id) continue
      if (!unique.has(item.location_id)) unique.set(item.location_id, item)
    }
    return Array.from(unique.values())
  }, [sortedResults, best])

  const nearest = useMemo(() => {
    if (!filteredResults.length) return null
    return [...filteredResults].sort((a, b) => a.distance_km - b.distance_km)[0] || null
  }, [filteredResults])

  const savingVsNearest = useMemo(() => {
    if (!best || !nearest || best.location_id === nearest.location_id) return 0
    const nearestScore = scoreItem(nearest, includeFuel, includePath, includeTime)
    const bestScore = scoreItem(best, includeFuel, includePath, includeTime)
    return Number((nearestScore - bestScore).toFixed(2))
  }, [best, nearest, includeFuel, includePath, includeTime])

  const crossBorderInsight = useMemo(() => {
    return buildCrossBorderInsight(filteredResults, best, includeFuel, includePath, includeTime)
  }, [filteredResults, best, includeFuel, includePath, includeTime])

  const lastUpdated = useMemo(() => {
    if (!best?.captured_at) return null
    const diffMin = Math.max(0, Math.round((Date.now() - new Date(best.captured_at).getTime()) / 60000))
    if (diffMin < 1) return 'pravkar'
    if (diffMin < 60) return `pred ${diffMin} min`
    return `pred ${Math.round(diffMin / 60)} h`
  }, [best])

async function loadMoreResults() {
  if (!coords || loadingMore || !hasMore) return

  setLoadingMore(true)

  try {
    const params = new URLSearchParams({
      lat: String(coords.lat),
      lng: String(coords.lng),
      type: fuelType,
      radius: String(radius),
      amount: String(amount),
      mode: appMode,
      sortBy,
      batch: 'more',
      offset: String(nextOffset),
      country,
    })

    const res = await fetch(`/api/search?${params.toString()}`)

    if (!res.ok) {
      throw new Error('Failed to load more results')
    }

    const json = await res.json()
    const receivedCount = Number(json.results?.length || 0)
    const next = Number(json.next_offset || nextOffset + 5)

    setResults((prev) => {
      const map = new Map<string, Result>()
      for (const item of prev) map.set(item.location_id, item)
      const beforeSize = map.size
      for (const item of json.results || []) map.set(item.location_id, item)
      if (map.size === beforeSize && !json.has_more) setHasMore(false)
      return Array.from(map.values())
    })

    setNextOffset((current) => json.next_offset || current + 5)
    setHasMore(receivedCount > 0 && Boolean(json.has_more))
    setShowOthers(true)

    trackEvent('load_more_results', {
      next_offset: next,
      received_count: receivedCount,
      sort_by: sortBy,
      radius,
      fuel_type: fuelType,
      brand,
    })
  } catch {
    trackEvent('load_more_failed', {
      sort_by: sortBy,
      radius,
      fuel_type: fuelType,
      brand,
    })
    setHasMore(false)
  } finally {
    setLoadingMore(false)
  }
}


  const runSearch = useCallback(
    async (point: { lat: number; lng: number }) => {
      if (appMode === 'route') return

      const requestId = ++activeRequestId.current

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setSearched(true)
      setShowOthers(false)
      setStatus('routing')

      try {
        const params = new URLSearchParams({
          lat: String(point.lat),
          lng: String(point.lng),
          type: fuelType,
          radius: String(radius),
          amount: String(amount),
              mode: appMode,
          batch: 'initial',
          country,
        })

        const res = await fetch(`/api/search?${params.toString()}`, {
          signal: controller.signal,
        })

        if (!res.ok) {
          throw new Error('Search failed')
        }

        const json = await res.json()

        if (requestId !== activeRequestId.current) return

        setResults(json.results || [])
        setNextOffset(json.next_offset || 6)
        setHasMore(Boolean(json.has_more))
        setStatus('done')

        trackEvent('search_completed', {
          fuel_type: fuelType,
          radius,
          amount,
          brand,
          results_count: Number(json.results?.length || 0),
          has_more: Boolean(json.has_more),
        })
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        if (requestId !== activeRequestId.current) return

        trackEvent('search_failed', {
          fuel_type: fuelType,
          radius,
          amount,
          brand,
        })

        setStatus('error')
      }
    },
    [fuelType, radius, amount, appMode, country]
  )


  const requestLocationAndSearch = useCallback(() => {
  if (appMode === 'route') {
    alert('Način “Na poti” dodamo v naslednjem koraku. Za zdaj uporabi “Okoli mene”.')
    return
  }

  if (!navigator.geolocation) {
    alert('Tvoj brskalnik ne podpira zaznave lokacije.')
    setStatus('error')
    return
  }

  setSearched(true)
  setStatus('location')

  navigator.geolocation.getCurrentPosition(
    (position) => {
      trackEvent('location_allowed')

      setCoords({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      })
    },
    () => {
      trackEvent('location_denied')
      alert('Lokacije ni bilo mogoče pridobiti. Dovoli dostop do lokacije in poskusi znova.')
      setStatus('error')
    },
    { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 }
  )
}, [appMode])

  useEffect(() => {
    if (didAutoLocate.current) return
    didAutoLocate.current = true
    requestLocationAndSearch()
  }, [requestLocationAndSearch])

  

  function mapsUrl(item: Result) {
    return `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}`
  }

  async function shareResult() {
    if (!best) return

    trackEvent('share_result', {
      station_country: best.country_code || null,
      station_brand: best.brand || null,
    })

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

  function handleSortChange(value: SortBy) {
    setSortBy(value)
    setShowOthers(false)

    trackEvent('sort_changed', {
      sort_by: value,
    })
  }

  return (
    <main id="top" className="min-h-screen overflow-x-hidden bg-[#06140f] pb-24 text-white md:pb-0">
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
            appMode={appMode}
            setAppMode={setAppMode}
            loading={loading}
            status={status}
            search={requestLocationAndSearch}
            includeFuel={includeFuel}
            setIncludeFuel={setIncludeFuel}
            includePath={includePath}
            setIncludePath={setIncludePath}
            includeTime={includeTime}
            setIncludeTime={setIncludeTime}
            brand={brand}
            setBrand={setBrand}
            brandOptions={brandOptions}
            country={country}
            setCountry={setCountry}
          />

          <ResultPanel
            best={best}
            sortBy={sortBy}
            setSortBy={handleSortChange}
            otherResults={otherResults}
            showOthers={showOthers}
            setShowOthers={setShowOthers}
            loading={loading}
            searched={searched}
            status={status}
            hasAnyResults={results.length > 0}
            lastUpdated={lastUpdated}
            savingVsNearest={savingVsNearest}
            mapsUrl={mapsUrl}
            shareResult={shareResult}
            shareCopied={shareCopied}
            includeFuel={includeFuel}
            includePath={includePath}
            includeTime={includeTime}
hasMore={hasMore}
loadingMore={loadingMore}
loadMoreResults={loadMoreResults}
crossBorderInsight={crossBorderInsight}
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
  brandOptions,
  appMode,
  setAppMode,
  loading,
  status,
  search,
  includeFuel,
  setIncludeFuel,
  includePath,
  setIncludePath,
  includeTime,
  setIncludeTime,
  country,
  setCountry,
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
        <span>Slovenija, Hrvaška, Avstrija, Italija</span>
      </div>

      <h1 className="mt-6 max-w-xl text-[48px] font-black leading-[.93] tracking-[-.055em] sm:text-[64px] lg:text-[72px] xl:text-[78px]">
        Ne tankaj več na pamet.
      </h1>

      <p className="mt-5 max-w-lg text-base leading-relaxed text-white/60 sm:text-lg">
        Odpri app, dovoli lokacijo in Tankaj.si sam izračuna najboljšo izbiro. Gorivo in radij preračunamo, znamko pa lahko nato filtriraš takoj brez ponovnega čakanja.
      </p>

      <ModeSwitch appMode={appMode} setAppMode={setAppMode} />

      {appMode === 'route' && (
        <div className="mt-4 rounded-[22px] border border-[#b9fb6a]/20 bg-[#b9fb6a]/10 p-4 text-sm leading-relaxed text-[#b9fb6a]">
          <span className="font-black">Na poti</span> bo iskal črpalke med tvojo lokacijo in ciljem. To dodamo v naslednjem koraku.
        </div>
      )}

      <div className="mt-4 rounded-[26px] border border-white/10 bg-[#123024]/72 p-3 sm:p-4 lg:p-5">
        <div className="grid gap-4 sm:grid-cols-2 items-end">
          <SelectDark label="Gorivo" value={fuelType} onChange={setFuelType} options={[['PETROL_95', 'Bencin 95'], ['DIESEL', 'Dizel']]} />
          <SelectDark label="Radius" value={String(radius)} onChange={(v) => setRadius(Number(v))} options={[['5', '5 km'], ['10', '10 km'], ['25', '25 km'], ['50', '50 km'], ['100', '100 km'], ['200', '200 km']]} />

          <label>
            <span className="mb-1.5 block text-xs font-semibold text-white/50">Količina</span>
            <input
              value={amount}
              onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
              type="number"
              min={1}
              className="h-[56px] sm:h-[64px] w-full rounded-2xl border border-white/10 bg-[#071a12] px-4 text-[15px] font-semibold text-white outline-none transition focus:border-[#b9fb6a]/70"
            />
          </label>

          <SelectDark label="Znamka" value={brand} onChange={setBrand} options={brandOptions} />
          <SelectDark
  label="Država"
  value={country}
  onChange={setCountry}
  options={[
    ['ALL', 'Vse države'],
    ['SI', 'Slovenija'],
    ['HR', 'Hrvaška'],
    ['AT', 'Avstrija'],
    ['IT', 'Italija'],
  ]}
/>

          <button
            onClick={search}
            disabled={loading || appMode === 'route'}
className="h-[56px] sm:h-[64px] rounded-2xl bg-[#b9fb6a] px-5 text-sm font-black text-[#071a12] shadow-[0_12px_30px_rgba(185,251,106,.22)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 sm:col-span-2"          >
            {appMode === 'route' ? 'Na poti kmalu' : status === 'location' ? 'Pridobivam lokacijo ...' : status === 'routing' ? 'Računam realne poti ...' : 'Osveži najboljšo izbiro'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <ToggleInfo title="Gorivo" text="Cena × količina" active={includeFuel} onClick={() => setIncludeFuel((v: boolean) => !v)} />
        <ToggleInfo title="Pot" text="Realna vožnja" active={includePath} onClick={() => setIncludePath((v: boolean) => !v)} />
        <ToggleInfo title="Čas" text="Privzeto 12 €/h" active={includeTime} onClick={() => setIncludeTime((v: boolean) => !v)} />
      </div>
    </div>
  )
}

function ResultPanel({
  best,
  sortBy,
  setSortBy,
  otherResults,
  showOthers,
  setShowOthers,
  loading,
  searched,
  status,
  hasAnyResults,
  lastUpdated,
  savingVsNearest,
  mapsUrl,
  shareResult,
  shareCopied,
  includeFuel,
  includePath,
  includeTime,
  hasMore,
  loadingMore,
  loadMoreResults,
  crossBorderInsight,
}: any) {
  return (
    <div id="result" className="rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(185,251,106,.18),transparent_32%),linear-gradient(180deg,rgba(15,48,34,.86),rgba(5,20,14,.88))] p-4 shadow-[0_25px_80px_rgba(0,0,0,.25)] backdrop-blur-2xl sm:p-6 lg:min-h-[720px] lg:p-8">
      {loading && <LoadingState status={status} />}

      {searched && !loading && status === 'done' && !best && (
        <EmptyState
          text={
            hasAnyResults
              ? 'Za izbrano znamko trenutno ni izračunane možnosti v izračunanem izboru. Prikaži vse znamke ali naloži dodatne možnosti.'
              : 'V izbranem radiju trenutno ni izračunanih možnosti. Povečaj radij ali poskusi znova.'
          }
        />
      )}

      {searched && !loading && status === 'error' && (
        <EmptyState text="Pri iskanju je prišlo do napake. Poskusi znova." />
      )}

      {!searched && !loading && <ExampleState />}

      {!loading && best && (
        <>
          <div className="mb-4 rounded-[24px] border border-white/10 bg-black/15 p-1">
            <div className="grid grid-cols-3 gap-1">
              {sortOptions.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSortBy(value)}
                  className={`rounded-[19px] px-2 py-3 text-xs font-black transition sm:text-sm ${
                    sortBy === value
                      ? 'bg-[#b9fb6a] text-[#071a12] shadow-[0_10px_24px_rgba(185,251,106,.18)]'
                      : 'text-white/55 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <BestCard
            item={{
              ...best,
              recommendation_reason: reasonBySort(sortBy),
            }}
            savingVsNearest={savingVsNearest}
            mapsUrl={mapsUrl}
            shareResult={shareResult}
            shareCopied={shareCopied}
            includeFuel={includeFuel}
            includePath={includePath}
            includeTime={includeTime}
          />

          {crossBorderInsight && (
            <CrossBorderCard insight={crossBorderInsight} mapsUrl={mapsUrl} />
          )}

          {(otherResults.length > 0 || hasMore) && (
            <>
              <div className="mt-4 flex items-center justify-between gap-3">
                <h2 className="text-xl font-black tracking-tight">Druge odlične možnosti</h2>
                {lastUpdated && <div className="text-xs text-white/40">Cene {lastUpdated}</div>}
              </div>

              {showOthers && otherResults.length > 0 && (
                <div className="mt-3 space-y-2.5 lg:space-y-3">
                  {otherResults.map((item: Result) => (
                    <CompactResult
                      key={item.location_id}
                      item={item}
                      mapsUrl={mapsUrl}
                      includeFuel={includeFuel}
                      includePath={includePath}
                      includeTime={includeTime}
                    />
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  if (!showOthers) {
                    setShowOthers(true)
                    trackEvent('other_options_opened')
                    return
                  }

                  if (hasMore) loadMoreResults()
                }}
                disabled={loadingMore || (!hasMore && showOthers)}
                className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-sm font-black text-white transition hover:bg-white/[0.1] disabled:opacity-60"
              >
                {loadingMore
                  ? 'Računam dodatne možnosti ...'
                  : !showOthers
                    ? 'Prikaži druge odlične možnosti'
                    : hasMore
                      ? 'Naloži še 5 možnosti'
                      : 'Prikazane so vse izračunane možnosti'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

function BestCard({
  item,
  savingVsNearest,
  mapsUrl,
  shareResult,
  shareCopied,
  includeFuel,
  includePath,
  includeTime,
}: any) {
  const displayTotal = scoreItem(item, includeFuel, includePath, includeTime)

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

        <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/75">
          {countryLabel(item.country_code)}
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
          <CostPill label="Gorivo" value={includeFuel ? formatMoney(item.fuel_cost) : '—'} active={includeFuel} />
          <CostPill label="Pot" value={includePath ? formatMoney(item.travel_fuel_cost) : '—'} active={includePath} />
          <CostPill label="Čas" value={includeTime ? formatMoney(item.time_cost) : '—'} active={includeTime} />
        </div>

        <div className="mt-3 rounded-2xl border border-[#b9fb6a]/70 bg-[#b9fb6a]/12 p-4 text-white shadow-[0_0_0_1px_rgba(185,251,106,.08),0_18px_46px_rgba(185,251,106,.10)]">
          <div className="text-xs font-black uppercase tracking-[.2em] text-[#b9fb6a]/85">Ocenjen skupni strošek</div>
          <div className="mt-1 text-3xl font-black text-[#b9fb6a]">{formatMoney(displayTotal)}</div>
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
          onClick={() =>
            trackEvent('navigation_clicked', {
              source: 'winner_card',
              station_country: item.country_code || null,
              station_brand: item.brand || null,
            })
          }
          className="rounded-2xl bg-white px-4 py-3 text-center text-sm font-black text-[#071a12]"
        >
          Navigacija
        </a>
        <button onClick={shareResult} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-white transition hover:bg-white/[0.08]">
          {shareCopied ? 'Kopirano ✓' : 'Deli'}
        </button>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-white/35">
        Izračun je ocena poti do črpalke. Google Maps lahko pokaže drugačen čas zaradi prometa ali prehoda meje.
      </p>
    </div>
  )
}

function CompactResult({
  item,
  mapsUrl,
  includeFuel,
  includePath,
  includeTime,
}: {
  item: Result
  mapsUrl: (item: Result) => string
  includeFuel: boolean
  includePath: boolean
  includeTime: boolean
}) {
  const displayTotal = scoreItem(item, includeFuel, includePath, includeTime)

  return (
    <a
      href={mapsUrl(item)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() =>
        trackEvent('navigation_clicked', {
          source: 'compact_result',
          station_country: item.country_code || null,
          station_brand: item.brand || null,
        })
      }
      className="block rounded-[22px] border border-white/8 bg-white/[0.06] p-3 transition hover:bg-white/[0.09]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xs font-black ${brandColor(item.brand)}`}>
            {brandShort(item.brand)}
          </div>

          <div className="min-w-0">
            <div className="truncate text-sm font-black text-white">{item.name}</div>
            <div className="mt-0.5 truncate text-[11px] text-white/40">
              {countryLabel(item.country_code)} · {item.address}
            </div>
            <div className="mt-1 text-lg font-black text-[#b9fb6a]">{item.price.toFixed(3)} €/L</div>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-xs font-black text-white/80">{formatKm(item.distance_km)}</div>
          <div className="text-[11px] text-white/40">~{item.estimated_drive_minutes} min</div>
          <div className="mt-1 text-[10px] text-white/40">skupaj</div>
          <div className="text-sm font-black text-[#b9fb6a]">{formatMoney(displayTotal)}</div>
        </div>
      </div>
    </a>
  )
}

function ExampleState() {
  return (
    <div className="flex h-full min-h-[520px] flex-col justify-center">
      <div className="text-xs font-black uppercase tracking-[.28em] text-[#b9fb6a]">Samodejni izračun</div>
      <h2 className="mt-3 max-w-xl text-4xl font-black leading-tight tracking-tight">
        Dovoli lokacijo in rezultat se izračuna sam.
      </h2>

      <div className="mt-7 space-y-3">
        <div className="rounded-3xl bg-white/[0.07] p-4">
          <div className="text-sm text-white/45">1. Lokacija</div>
          <div className="mt-1 text-2xl font-black text-[#b9fb6a]">najbližje realne poti</div>
        </div>

        <div className="rounded-3xl bg-white/[0.07] p-4">
          <div className="text-sm text-white/45">2. Parametri</div>
          <div className="mt-1 text-2xl font-black text-[#b9fb6a]">gorivo, radij, količina</div>
        </div>

        <div className="rounded-3xl bg-[#b9fb6a] p-4 text-[#071a12]">
          <div className="text-sm opacity-70">3. Rezultat</div>
          <div className="mt-1 text-2xl font-black">ena najboljša izbira + alternative</div>
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
  return <div className="rounded-[28px] border border-white/10 bg-white/[0.06] p-6 text-white/65">{text}</div>
}

function CostPill({ label, value, active = true }: { label: string; value: string; active?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${active ? 'bg-white/10' : 'bg-white/[0.035] opacity-45'}`}>
      <div className="text-[10px] font-black uppercase tracking-[.18em] text-white/38">{label}</div>
      <div className="mt-1 text-sm font-black">{value}</div>
    </div>
  )
}

function ToggleInfo({
  title,
  text,
  active,
  onClick,
}: {
  title: string
  text: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-3 text-left transition ${
        active
          ? 'border-[#b9fb6a]/35 bg-[#b9fb6a]/12'
          : 'border-white/10 bg-white/[0.04] opacity-55'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-black text-white">{title}</div>
        <div className={`h-4 w-4 rounded-full border ${active ? 'border-[#b9fb6a] bg-[#b9fb6a]' : 'border-white/25'}`} />
      </div>
      <div className="mt-1 text-xs text-white/45">{text}</div>
    </button>
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
    <section id="how-it-works" className="mt-5 rounded-[30px] border border-white/10 bg-white/[0.055] p-5 backdrop-blur-2xl sm:p-7">
      <h2 className="text-3xl font-black tracking-tight">Kako deluje?</h2>
      <p className="mt-4 max-w-4xl text-sm leading-relaxed text-white/60 sm:text-base">
        Tankaj.si samodejno izračuna realne poti do črpalk v izbranem radiju. Nato lahko rezultat takoj razvrščaš po priporočilu, najnižji ceni ali najbližji poti. Uporabnik lahko sam določi, ali se pri skupnem strošku upoštevajo gorivo, pot in čas.
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <MiniInfo title="Formula" text="gorivo + pot + čas" />
        <MiniInfo title="Radius" text="Vedno upoštevamo tvoj izbor" />
        <MiniInfo title="Samodejno" text="Osvežitev ob spremembi parametrov" />
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


function CrossBorderCard({
  insight,
  mapsUrl,
}: {
  insight: {
    saving: number
    homeCountry: string
    crossCountry?: string | null
    station: Result
    isWorthIt: boolean
  }
  mapsUrl: (item: Result) => string
}) {
  return (
    <a
      href={mapsUrl(insight.station)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() =>
        trackEvent('navigation_clicked', {
          source: 'cross_border_card',
          station_country: insight.station.country_code || null,
          station_brand: insight.station.brand || null,
        })
      }
      className={`mt-3 block rounded-[22px] border p-4 transition ${
        insight.isWorthIt
          ? 'border-[#b9fb6a]/35 bg-[#b9fb6a]/12 hover:bg-[#b9fb6a]/16'
          : 'border-white/10 bg-white/[0.045] hover:bg-white/[0.07]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[.22em] text-[#b9fb6a]">
            Čez mejo
          </div>

          <div className="mt-1 text-lg font-black text-white">
            {insight.isWorthIt ? 'Čez mejo se lahko splača.' : 'Čez mejo se trenutno ne splača.'}
          </div>

          <div className="mt-1 text-sm leading-relaxed text-white/52">
            {insight.isWorthIt
              ? `Najboljša možnost čez mejo prihrani približno ${insight.saving.toFixed(
                  2
                )} € proti najboljši domači možnosti.`
              : 'Cene čez mejo niso dovolj boljše, da bi pokrile dodatno pot in čas.'}
          </div>

          <div className="mt-3 text-sm font-black text-[#b9fb6a]">
            {insight.station.name} · {countryLabel(insight.crossCountry)}
          </div>
        </div>

        <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/65">
          {insight.homeCountry} → {countryLabel(insight.crossCountry)}
        </div>
      </div>
    </a>
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
className="h-[56px] sm:h-[64px] w-full appearance-none rounded-2xl border border-white/10 bg-[#071a12] bg-[linear-gradient(45deg,transparent_50%,rgba(255,255,255,.6)_50%),linear-gradient(135deg,rgba(255,255,255,.6)_50%,transparent_50%)] bg-[length:5px_5px,5px_5px] bg-[position:calc(100%-18px)_25px,calc(100%-13px)_25px] sm:bg-[position:calc(100%-18px)_29px,calc(100%-13px)_29px] bg-no-repeat px-4 pr-10 text-[15px] font-semibold text-white outline-none transition focus:border-[#b9fb6a]/70"      >
        {options.map(([value, label]) => (
          <option key={value} value={value} className="bg-[#071a12] text-white">
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}
