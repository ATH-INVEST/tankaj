'use client'

import { useMemo, useRef, useState } from 'react'

type Result = {
  location_id: string
  name: string
  brand: string
  address: string
  city: string | null
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
  is_preferred_brand?: boolean
  preference_applied?: boolean
  route_source?: string
  captured_at: string
}

type SearchStatus =
  | 'idle'
  | 'location'
  | 'routing'
  | 'done'
  | 'error'

export default function Home() {
  const [fuelType, setFuelType] = useState('PETROL_95')
  const [radius, setRadius] = useState(25)
  const [amount, setAmount] = useState(50)
  const [brand, setBrand] = useState('ALL')
  const [preferredBrand, setPreferredBrand] = useState('NONE')
  const [results, setResults] = useState<Result[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [searched, setSearched] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const activeRequestId = useRef(0)

  const loading = status === 'location' || status === 'routing'
  const best = results?.[0]

  const preferredPick =
    preferredBrand !== 'NONE'
      ? [...results]
          .filter((r) => r.is_preferred_brand)
          .sort((a, b) => a.distance_km - b.distance_km)[0]
      : null

  const showPreferredSeparately =
    preferredPick && best && preferredPick.location_id !== best.location_id

  const worst = useMemo(() => {
    if (!results.length) return null
    return [...results].sort(
      (a, b) =>
        Number(b.effective_total_cost ?? b.fuel_cost ?? 0) -
        Number(a.effective_total_cost ?? a.fuel_cost ?? 0)
    )[0]
  }, [results])

  const possibleSavings =
    best && worst
      ? Math.max(
          0,
          Number(worst.effective_total_cost ?? 0) -
            Number(best.effective_total_cost ?? 0)
        )
      : 0

  const lastUpdated = useMemo(() => {
    if (!best?.captured_at) return null

    const diffMs = Date.now() - new Date(best.captured_at).getTime()
    const diffMin = Math.max(0, Math.round(diffMs / 60000))

    if (diffMin < 1) return 'pravkar'
    if (diffMin < 60) return `pred ${diffMin} min`

    const diffH = Math.round(diffMin / 60)
    return `pred ${diffH} h`
  }, [best])

  async function search() {
    const requestId = ++activeRequestId.current

    setSearched(true)
    setStatus('location')

    if (!navigator.geolocation) {
      alert('Tvoj brskalnik ne podpira zaznave lokacije.')
      setStatus('error')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (requestId !== activeRequestId.current) return

        const lat = position.coords.latitude
        const lng = position.coords.longitude

        setStatus('routing')

        try {
          const res = await fetch(
            `/api/search?lat=${lat}&lng=${lng}&type=${fuelType}&radius=${radius}&amount=${amount}&brand=${brand}&preferredBrand=${preferredBrand}`
          )

          const json = await res.json()

          if (requestId !== activeRequestId.current) return

          setResults(json.results || [])
          setStatus('done')
        } catch {
          if (requestId !== activeRequestId.current) return
          setStatus('error')
        }
      },
      () => {
        if (requestId !== activeRequestId.current) return

        alert(
          'Lokacije ni bilo mogoče pridobiti. Dovoli dostop do lokacije in poskusi znova.'
        )
        setStatus('error')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  function mapsUrl(item: Result) {
    return `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}`
  }

  function routeText(item: Result) {
    if (item.route_source === 'openrouteservice') {
      return `približno ${item.estimated_drive_minutes} min`
    }

    return 'ocena po zračni razdalji'
  }

  async function shareResult() {
    if (!best) return

    const text =
      possibleSavings > 0.2
        ? `Tankaj.si mi je našel boljšo izbiro za tankanje. Prihranek pri tem izračunu: približno ${possibleSavings.toFixed(
            2
          )} €.`
        : `Tankaj.si mi je našel najbolj smiselno črpalko glede na ceno, razdaljo in strošek poti.`

    const url = window.location.origin

    if (navigator.share) {
      await navigator.share({
        title: 'Tankaj.si',
        text,
        url,
      })
      return
    }

    await navigator.clipboard.writeText(`${text} ${url}`)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 1800)
  }

  function Card({
    item,
    label,
    note,
    accent = false,
  }: {
    item: Result
    label: string
    note: string
    accent?: boolean
  }) {
    return (
      <div
        className={`mt-6 rounded-[32px] p-6 shadow-sm ${
          accent
            ? 'bg-[#10251b] text-white'
            : 'bg-white text-[#10251b] ring-1 ring-black/5'
        }`}
      >
        <div className={`text-sm ${accent ? 'text-white/60' : 'text-[#607067]'}`}>
          {label}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="text-3xl font-semibold tracking-tight">{item.name}</div>

          {item.is_preferred_brand && (
            <span className="rounded-full bg-[#dff7e8] px-3 py-1 text-xs font-semibold text-[#0d6b43]">
              preferirana znamka
            </span>
          )}
        </div>

        <div className={`mt-3 ${accent ? 'text-white/70' : 'text-[#607067]'}`}>
          {item.address}
          {item.city ? `, ${item.city}` : ''}
        </div>

        <div className={`mt-3 text-sm ${accent ? 'text-[#b9fb6a]' : 'text-[#0f6b46]'}`}>
          {note}
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className={`rounded-2xl p-4 ${accent ? 'bg-white/10' : 'bg-[#f5f7f4]'}`}>
            <div className={`text-sm ${accent ? 'text-white/60' : 'text-[#607067]'}`}>
              Cena
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {item.price.toFixed(3)} €/L
            </div>
          </div>

          <div className={`rounded-2xl p-4 ${accent ? 'bg-white/10' : 'bg-[#f5f7f4]'}`}>
            <div className={`text-sm ${accent ? 'text-white/60' : 'text-[#607067]'}`}>
              Ocenjena vožnja
            </div>
            <div className="mt-1 text-2xl font-semibold">{item.distance_km} km</div>
            <div className={`mt-1 text-sm ${accent ? 'text-white/55' : 'text-[#607067]'}`}>
              {routeText(item)}
            </div>
          </div>

          <div className={`rounded-2xl p-4 ${accent ? 'bg-white/10' : 'bg-[#f5f7f4]'}`}>
            <div className={`text-sm ${accent ? 'text-white/60' : 'text-[#607067]'}`}>
              Strošek poti
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {Number(item.travel_fuel_cost ?? 0).toFixed(2)} €
            </div>
          </div>

          <div className="rounded-2xl bg-[#b9fb6a] p-4 text-[#10251b]">
            <div className="text-sm opacity-70">Skupaj za {amount} L</div>
            <div className="mt-1 text-2xl font-semibold">
              {Number(item.effective_total_cost ?? item.fuel_cost ?? 0).toFixed(2)} €
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={mapsUrl(item)}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex rounded-2xl px-5 py-3 font-semibold ${
              accent ? 'bg-white text-[#10251b]' : 'bg-[#10251b] text-white'
            }`}
          >
            Odpri navigacijo
          </a>

          {accent && (
            <button
              onClick={shareResult}
              className="inline-flex rounded-2xl border border-white/15 px-5 py-3 font-semibold text-white hover:bg-white/10"
            >
              {shareCopied ? 'Kopirano ✓' : 'Deli rezultat'}
            </button>
          )}
        </div>

        <div className={`mt-4 text-xs ${accent ? 'text-white/45' : 'text-[#607067]'}`}>
          Čas vožnje je ocena brez Google prometnih podatkov. Navigacija lahko pokaže
          drugačen čas.
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[#f5f7f4] text-[#10251b]">
      <section className="mx-auto max-w-6xl px-5 py-10 md:py-14">
        <div className="grid items-end gap-10 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <div className="mb-4 inline-flex rounded-full bg-[#dff7e8] px-4 py-2 text-sm font-medium text-[#0d6b43]">
              Tankaj.si BETA
            </div>

            <h1 className="max-w-4xl text-5xl font-semibold tracking-tight md:text-7xl">
              Ne tankaj več na pamet.
            </h1>

            <p className="mt-5 max-w-2xl text-xl leading-relaxed text-[#607067]">
              Tankaj.si izračuna, katera črpalka se ti dejansko splača: cena goriva,
              realna vožnja, čas, strošek poti in tvoje preference.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <button
                onClick={search}
                className="rounded-2xl bg-[#10251b] px-6 py-4 font-semibold text-white shadow-sm hover:bg-[#183927]"
              >
                Preveri najboljšo izbiro
              </button>

              <a
                href="#kalkulator"
                className="rounded-2xl bg-white px-6 py-4 font-semibold text-[#10251b] shadow-sm ring-1 ring-black/5"
              >
                Nastavi ročno
              </a>
            </div>

            <div className="mt-7 grid max-w-2xl gap-3 text-sm text-[#607067] md:grid-cols-3">
              <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                <div className="font-semibold text-[#10251b]">Upoštevamo pot</div>
                <div className="mt-1">
                  Cenejše gorivo ni nujno cenejše, če se moraš peljati predaleč.
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                <div className="font-semibold text-[#10251b]">Skupni strošek</div>
                <div className="mt-1">
                  Cena goriva + ocenjen strošek poti + čas vožnje.
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                <div className="font-semibold text-[#10251b]">Tvoja navada</div>
                <div className="mt-1">
                  Preferirano znamko upoštevamo, kadar je razlika majhna.
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[32px] bg-[#10251b] p-6 text-white shadow-sm">
            <div className="text-sm text-white/50">Primer izračuna</div>
            <div className="mt-3 text-3xl font-semibold">
              Najnižja cena na liter ni vedno najboljša izbira.
            </div>

            <div className="mt-5 grid gap-3">
              <div className="rounded-2xl bg-white/10 p-4">
                <div className="text-sm text-white/55">Črpalka A</div>
                <div className="mt-1 text-xl font-semibold">1.605 €/L · 5 km stran</div>
              </div>

              <div className="rounded-2xl bg-white/10 p-4">
                <div className="text-sm text-white/55">Črpalka B</div>
                <div className="mt-1 text-xl font-semibold">1.589 €/L · 28 km stran</div>
              </div>

              <div className="rounded-2xl bg-[#b9fb6a] p-4 text-[#10251b]">
                <div className="text-sm opacity-70">Tankaj.si preveri razliko</div>
                <div className="mt-1 text-xl font-semibold">
                  manj vožnje je lahko cenejše kot nižja cena
                </div>
              </div>
            </div>
          </div>
        </div>

        <div id="kalkulator" className="mt-12 rounded-[32px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="grid gap-4 md:grid-cols-3">
            <label>
              <span className="mb-2 block text-sm font-medium text-[#607067]">Gorivo</span>
              <select
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value)}
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3"
              >
                <option value="DIESEL">Dizel</option>
                <option value="PETROL_95">Bencin 95</option>
              </select>
            </label>

            <label>
              <span className="mb-2 block text-sm font-medium text-[#607067]">Radius</span>
              <select
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3"
              >
                <option value={5}>5 km</option>
                <option value={10}>10 km</option>
                <option value={25}>25 km</option>
                <option value={50}>50 km</option>
                <option value={100}>100 km</option>
              </select>
            </label>

            <label>
              <span className="mb-2 block text-sm font-medium text-[#607067]">Količina</span>
              <input
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                type="number"
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3"
              />
            </label>

            <label>
              <span className="mb-2 block text-sm font-medium text-[#607067]">Prikaži znamke</span>
              <select
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3"
              >
                <option value="ALL">Vse znamke</option>
                <option value="PETROL">Petrol</option>
                <option value="MOL">MOL</option>
                <option value="SHELL">Shell</option>
                <option value="OMV">OMV</option>
                <option value="MAXEN">Maxen</option>
              </select>
            </label>

            <label>
              <span className="mb-2 block text-sm font-medium text-[#607067]">
                Preferirana znamka
              </span>
              <select
                value={preferredBrand}
                onChange={(e) => setPreferredBrand(e.target.value)}
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3"
              >
                <option value="NONE">Brez preference</option>
                <option value="PETROL">Petrol</option>
                <option value="MOL">MOL</option>
                <option value="SHELL">Shell</option>
                <option value="OMV">OMV</option>
                <option value="MAXEN">Maxen</option>
              </select>
            </label>

            <button
              onClick={search}
              disabled={loading}
              className="mt-7 rounded-2xl bg-[#0f6b46] px-5 py-3 font-semibold text-white shadow-sm hover:bg-[#0b5638] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {status === 'location'
                ? 'Pridobivam lokacijo ...'
                : status === 'routing'
                  ? 'Računam poti ...'
                  : 'Poišči'}
            </button>
          </div>
        </div>

        {loading && (
          <div className="mt-6 rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
            <div className="text-sm font-medium text-[#607067]">
              {status === 'location'
                ? 'Pridobivam tvojo lokacijo ...'
                : 'Primerjam črpalke, cene in ocenjeno vožnjo ...'}
            </div>

            <div className="mt-4 h-8 w-72 animate-pulse rounded-full bg-black/10" />
            <div className="mt-6 grid gap-3 md:grid-cols-4">
              <div className="h-24 animate-pulse rounded-2xl bg-black/10" />
              <div className="h-24 animate-pulse rounded-2xl bg-black/10" />
              <div className="h-24 animate-pulse rounded-2xl bg-black/10" />
              <div className="h-24 animate-pulse rounded-2xl bg-black/10" />
            </div>
          </div>
        )}

        {searched && !loading && status === 'done' && results.length === 0 && (
          <div className="mt-6 rounded-[24px] bg-white p-6 shadow-sm ring-1 ring-black/5">
            V izbranem radiusu trenutno ni zadetkov. Poskusi povečati radius ali prikazati
            vse znamke.
          </div>
        )}

        {searched && !loading && status === 'error' && (
          <div className="mt-6 rounded-[24px] bg-white p-6 shadow-sm ring-1 ring-black/5">
            Pri iskanju je prišlo do napake. Poskusi znova.
          </div>
        )}

        {!loading && showPreferredSeparately && preferredPick && (
          <Card
            item={preferredPick}
            label="Najbližja preferirana znamka"
            note={`Najbližja znana možnost za ${preferredBrand}, tudi če ni najugodnejša skupna izbira.`}
          />
        )}

        {!loading && best && (
          <Card
            item={best}
            label="Najboljša skupna izbira"
            note={
              possibleSavings > 0.2
                ? `V primerjavi z manj ugodno možnostjo lahko prihraniš približno ${possibleSavings.toFixed(2)} €.`
                : 'Najboljše razmerje med ceno, razdaljo, časom in stroškom poti.'
            }
            accent
          />
        )}

        {!loading && best && lastUpdated && (
          <div className="mt-3 text-sm text-[#607067]">
            Cene so bile nazadnje posodobljene {lastUpdated}.
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="mt-6 grid gap-3">
            {results.map((item) => (
              <div
                key={item.location_id}
                className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold">
                      {item.name}
                      {item.is_preferred_brand && (
                        <span className="ml-2 rounded-full bg-[#dff7e8] px-2 py-1 text-xs text-[#0d6b43]">
                          preferirana
                        </span>
                      )}
                    </div>

                    <div className="mt-1 text-sm text-[#607067]">
                      {item.address}
                      {item.city ? `, ${item.city}` : ''}
                    </div>

                    <a
                      href={mapsUrl(item)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex text-sm font-semibold text-[#0f6b46]"
                    >
                      Navigacija →
                    </a>
                  </div>

                  <div className="text-right">
                    <div className="text-lg font-semibold">{item.price.toFixed(3)} €/L</div>
                    <div className="text-sm text-[#607067]">{item.distance_km} km</div>
                    <div className="text-sm text-[#607067]">
                      ~{item.estimated_drive_minutes} min
                    </div>
                    <div className="mt-1 text-sm font-semibold">
                      {Number(item.effective_total_cost ?? item.fuel_cost ?? 0).toFixed(2)} €
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}