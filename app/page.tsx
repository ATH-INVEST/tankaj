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

export default function Home() {
  const [fuelType, setFuelType] = useState('PETROL_95')
  const [radius, setRadius] = useState(50)
  const [amount, setAmount] = useState(50)
  const [brand, setBrand] = useState('ALL')
  const [preferredBrand, setPreferredBrand] = useState('NONE')
  const [results, setResults] = useState<Result[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [searched, setSearched] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const activeRequestId = useRef(0)

  const loading = status === 'location' || status === 'routing'
  const best = summary?.best_overall || results?.[0] || null
  const nearest = summary?.nearest || null
  const cheapestFuel = summary?.cheapest_fuel || null
  const crossBorder = summary?.best_cross_border || null
  const preferredPick = summary?.preferred_best || null

  const savingsText = useMemo(() => {
    const saving = Number(summary?.saving_vs_nearest || 0)
    if (saving > 0.2) return `Prihranek proti najbližji možnosti: približno ${saving.toFixed(2)} €.`
    return 'Najboljše razmerje med ceno, razdaljo, časom in stroškom poti.'
  }, [summary])

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
            `/api/search?lat=${lat}&lng=${lng}&type=${fuelType}&radius=${radius}&amount=${amount}&brand=${brand}&preferredBrand=${preferredBrand === 'NONE' ? '' : preferredBrand}`
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
        ? `Tankaj.si mi je našel boljšo izbiro za tankanje. Prihranek: približno ${saving.toFixed(2)} €.`
        : `Tankaj.si mi je našel najbolj smiselno črpalko glede na ceno, razdaljo in strošek poti.`

    if (navigator.share) {
      await navigator.share({ title: 'Tankaj.si', text, url: window.location.origin })
      return
    }

    await navigator.clipboard.writeText(`${text} ${window.location.origin}`)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 1800)
  }

  function StationCard({
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
      <div className={`mt-6 rounded-[32px] p-6 shadow-sm ${accent ? 'bg-[#10251b] text-white' : 'bg-white text-[#10251b] ring-1 ring-black/5'}`}>
        <div className={`text-sm ${accent ? 'text-white/60' : 'text-[#607067]'}`}>{label}</div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="text-3xl font-semibold tracking-tight">{item.name}</div>

          {item.country_code && (
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
              {item.country_code}
            </span>
          )}

          {item.is_cross_border && (
            <span className="rounded-full bg-[#b9fb6a] px-3 py-1 text-xs font-semibold text-[#10251b]">
              čez mejo
            </span>
          )}

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
          <Metric accent={accent} label="Cena" value={`${item.price.toFixed(3)} €/L`} />
          <Metric accent={accent} label="Vožnja" value={`${item.distance_km} km`} sub={`~${item.estimated_drive_minutes} min`} />
          <Metric accent={accent} label="Pot + čas" value={`${(Number(item.travel_fuel_cost || 0) + Number(item.time_cost || 0)).toFixed(2)} €`} />
          <div className="rounded-2xl bg-[#b9fb6a] p-4 text-[#10251b]">
            <div className="text-sm opacity-70">Skupaj za {amount} L</div>
            <div className="mt-1 text-2xl font-semibold">{Number(item.effective_total_cost || item.fuel_cost || 0).toFixed(2)} €</div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <a href={mapsUrl(item)} target="_blank" rel="noopener noreferrer" className={`inline-flex rounded-2xl px-5 py-3 font-semibold ${accent ? 'bg-white text-[#10251b]' : 'bg-[#10251b] text-white'}`}>
            Odpri navigacijo
          </a>

          {accent && (
            <button onClick={shareResult} className="inline-flex rounded-2xl border border-white/15 px-5 py-3 font-semibold text-white hover:bg-white/10">
              {shareCopied ? 'Kopirano ✓' : 'Deli rezultat'}
            </button>
          )}
        </div>

        <div className={`mt-4 text-xs ${accent ? 'text-white/45' : 'text-[#607067]'}`}>
          Čas vožnje je ocena brez Google prometnih podatkov. Navigacija lahko pokaže drugačen čas.
        </div>
      </div>
    )
  }

  function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
    return (
      <div className={`rounded-2xl p-4 ${accent ? 'bg-white/10' : 'bg-[#f5f7f4]'}`}>
        <div className={`text-sm ${accent ? 'text-white/60' : 'text-[#607067]'}`}>{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {sub && <div className={`mt-1 text-sm ${accent ? 'text-white/55' : 'text-[#607067]'}`}>{sub}</div>}
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
              Tankaj.si izračuna, katera črpalka se ti dejansko splača: cena goriva, realna vožnja, čas, strošek poti in tvoje preference.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <button onClick={search} className="rounded-2xl bg-[#10251b] px-6 py-4 font-semibold text-white shadow-sm hover:bg-[#183927]">
                Preveri najboljšo izbiro
              </button>

              <a href="#kalkulator" className="rounded-2xl bg-white px-6 py-4 font-semibold text-[#10251b] shadow-sm ring-1 ring-black/5">
                Nastavi ročno
              </a>
            </div>

            <div className="mt-7 grid max-w-2xl gap-3 text-sm text-[#607067] md:grid-cols-3">
              <Info title="Upoštevamo pot" text="Cenejše gorivo ni nujno cenejše, če se moraš peljati predaleč." />
              <Info title="Skupni strošek" text="Cena goriva + ocenjen strošek poti + čas vožnje." />
              <Info title="Tudi čez mejo" text="Ob meji primerjamo tudi Hrvaško, kjer je razlika lahko večja." />
            </div>
          </div>

          <div className="rounded-[32px] bg-[#10251b] p-6 text-white shadow-sm">
            <div className="text-sm text-white/50">Primer izračuna</div>
            <div className="mt-3 text-3xl font-semibold">Najnižja cena na liter ni vedno najboljša izbira.</div>

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
                <div className="mt-1 text-xl font-semibold">manj vožnje je lahko cenejše kot nižja cena</div>
              </div>
            </div>
          </div>
        </div>

        <div id="kalkulator" className="mt-12 rounded-[32px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="grid gap-4 md:grid-cols-3">
            <Select label="Gorivo" value={fuelType} onChange={setFuelType} options={[['PETROL_95', 'Bencin 95'], ['DIESEL', 'Dizel']]} />
            <Select label="Radius" value={String(radius)} onChange={(v) => setRadius(Number(v))} options={[['5', '5 km'], ['10', '10 km'], ['25', '25 km'], ['50', '50 km'], ['100', '100 km'], ['200', '200 km']]} />

            <label>
              <span className="mb-2 block text-sm font-medium text-[#607067]">Količina</span>
              <input value={amount} onChange={(e) => setAmount(Number(e.target.value))} type="number" className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3" />
            </label>

            <Select label="Prikaži znamke" value={brand} onChange={setBrand} options={BRANDS} />
            <Select label="Preferirana znamka" value={preferredBrand} onChange={setPreferredBrand} options={[['NONE', 'Brez preference'], ...BRANDS.filter(([v]) => v !== 'ALL')]} />

            <button onClick={search} disabled={loading} className="mt-7 rounded-2xl bg-[#0f6b46] px-5 py-3 font-semibold text-white shadow-sm hover:bg-[#0b5638] disabled:cursor-not-allowed disabled:opacity-70">
              {status === 'location' ? 'Pridobivam lokacijo ...' : status === 'routing' ? 'Računam izbiro ...' : 'Poišči'}
            </button>
          </div>
        </div>

        {loading && (
          <div className="mt-6 rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
            <div className="text-sm font-medium text-[#607067]">
              {status === 'location' ? 'Pridobivam tvojo lokacijo ...' : 'Primerjam črpalke, cene, razdaljo in strošek poti ...'}
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
            V izbranem radiusu trenutno ni zadetkov. Poskusi povečati radius ali prikazati vse znamke.
          </div>
        )}

        {searched && !loading && status === 'error' && (
          <div className="mt-6 rounded-[24px] bg-white p-6 shadow-sm ring-1 ring-black/5">
            Pri iskanju je prišlo do napake. Poskusi znova.
          </div>
        )}

        {!loading && preferredPick && best && preferredPick.location_id !== best.location_id && (
          <StationCard item={preferredPick} label="Najboljša preferirana znamka" note={`Najboljša najdena možnost za ${preferredBrand}.`} />
        )}

        {!loading && best && (
          <StationCard item={best} label="Najboljša skupna izbira" note={savingsText} accent />
        )}

        {!loading && crossBorder && best && crossBorder.location_id !== best.location_id && (
          <StationCard item={crossBorder} label="Najboljša izbira čez mejo" note="Primerjava vključuje tudi bližnje črpalke na Hrvaškem." />
        )}

        {!loading && nearest && best && nearest.location_id !== best.location_id && (
          <StationCard item={nearest} label="Najbližja možnost" note="Najbližja črpalka ni nujno najugodnejša skupna izbira." />
        )}

        {!loading && cheapestFuel && best && cheapestFuel.location_id !== best.location_id && (
          <StationCard item={cheapestFuel} label="Najnižja cena na liter" note="Najnižja cena na liter se lahko zaradi razdalje izkaže kot manj ugodna." />
        )}

        {!loading && best && lastUpdated && (
          <div className="mt-3 text-sm text-[#607067]">Cene so bile nazadnje posodobljene {lastUpdated}.</div>
        )}

        {!loading && results.length > 0 && (
          <div className="mt-6 grid gap-3">
            {results.map((item) => (
              <div key={item.location_id} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold">
                      {item.name}
                      {item.country_code && <span className="ml-2 rounded-full bg-black/5 px-2 py-1 text-xs">{item.country_code}</span>}
                      {item.is_preferred_brand && <span className="ml-2 rounded-full bg-[#dff7e8] px-2 py-1 text-xs text-[#0d6b43]">preferirana</span>}
                    </div>
                    <div className="mt-1 text-sm text-[#607067]">{item.address}{item.city ? `, ${item.city}` : ''}</div>
                    <a href={mapsUrl(item)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex text-sm font-semibold text-[#0f6b46]">Navigacija →</a>
                  </div>

                  <div className="text-right">
                    <div className="text-lg font-semibold">{item.price.toFixed(3)} €/L</div>
                    <div className="text-sm text-[#607067]">{item.distance_km} km</div>
                    <div className="text-sm text-[#607067]">~{item.estimated_drive_minutes} min</div>
                    <div className="mt-1 text-sm font-semibold">{Number(item.effective_total_cost || item.fuel_cost || 0).toFixed(2)} €</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
<section className="mt-16 border-t border-black/5 pt-10">
  <div className="mx-auto max-w-3xl">
    <h2 className="text-3xl font-semibold tracking-tight">
      Kako deluje?
    </h2>

    <p className="mt-4 text-lg text-[#607067]">
      Tankaj.si ne išče samo najnižje cene goriva. Izračuna dejanski strošek
      vsake črpalke glede na tvojo lokacijo.
    </p>

    <div className="mt-6 space-y-4 text-[#607067]">
      <p>
        Upoštevamo:
      </p>

      <ul className="list-disc pl-5 space-y-2">
        <li>ceno goriva</li>
        <li>realno razdaljo in čas vožnje</li>
        <li>strošek goriva za pot (tja in nazaj)</li>
        <li>tvoj čas (ocenjen v € na uro)</li>
        <li>tvoje preference (npr. znamka)</li>
      </ul>
    </div>

    <div className="mt-8 rounded-2xl bg-[#f5f7f4] p-6 ring-1 ring-black/5">
      <div className="text-sm text-[#607067] mb-2">
        Poenostavljen izračun:
      </div>

      <div className="text-xl font-semibold tracking-tight">
        skupni strošek =
      </div>

      <div className="mt-2 text-[#10251b] font-medium">
        (cena goriva × količina)
        <br />
        + strošek poti
        <br />
        + vrednost časa
      </div>

      <div className="mt-4 text-sm text-[#607067]">
        Strošek poti vključuje gorivo za vožnjo do črpalke in nazaj.
        Čas vožnje pretvorimo v € (npr. 6 €/h), da dobimo realno odločitev.
      </div>
    </div>

    <p className="mt-6 text-sm text-[#607067]">
      Zato najcenejša cena na liter pogosto ni najboljša izbira.
    </p>
  </div>
</section>
      </section>
    </main>
  )
}

function Info({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
      <div className="font-semibold text-[#10251b]">{title}</div>
      <div className="mt-1">{text}</div>
    </div>
  )
}

function Select({
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
      <span className="mb-2 block text-sm font-medium text-[#607067]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3">
        {options.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </label>
  )
}