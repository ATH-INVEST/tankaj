import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getDrivingDistance } from "@/lib/ors";

type RouteSource = "openrouteservice" | "osrm";
type SortBy = "smart" | "price" | "distance";
type Batch = "initial" | "more";
type AustriaFuelType = "DIE" | "SUP" | "GAS";

type Result = {
  location_id: string;
  name: string;
  brand: string | null;
  address: string | null;
  city: string | null;
  country_code?: string | null;
  lat?: number | null;
  lng?: number | null;
  distance_km: number;
  estimated_drive_minutes?: number | null;
  fuel_type: string;
  price: number | null;
  total_cost?: number | null;
  fuel_cost?: number | null;
  source?: string | null;
  captured_at?: string | null;
  price_age_hours?: number | null;
  trusted_price?: boolean;
  price_warning?: string | null;
};

const MAX_PRICE_AGE_HOURS = 24;
const TANKERKOENIG_API_KEY = process.env.TANKERKOENIG_API_KEY || "";
const GERMANY_CACHE_TTL_MINUTES = 10;

type PriceQuality = {
  price_age_hours: number | null;
  trusted_price: boolean;
  price_warning: string | null;
};

function hoursSince(dateValue: string | null | undefined) {
  if (!dateValue) return Infinity;

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return Infinity;

  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

function normalizeFuelKey(fuelType: string) {
  return String(fuelType || "")
    .trim()
    .toUpperCase();
}

function isRealisticFuelPrice(
  countryCode: string | null | undefined,
  fuelType: string,
  price: number,
) {
  if (!Number.isFinite(price) || price <= 0) return false;

  const country = String(countryCode || "").toUpperCase();
  const fuel = normalizeFuelKey(fuelType);

  const isPetrol95 =
    fuel === "PETROL_95" ||
    fuel.includes("PETROL") ||
    fuel.includes("BENCIN") ||
    fuel.includes("GASOLINE") ||
    fuel.includes("EUROSUPER") ||
    fuel.includes("E5") ||
    fuel.includes("E10") ||
    fuel === "SUP";

  const isDiesel =
    fuel === "DIESEL" ||
    fuel.includes("DIESEL") ||
    fuel.includes("DIZEL") ||
    fuel.includes("EURODIESEL") ||
    fuel === "DIE";

  const isLpg = fuel.includes("LPG") || fuel.includes("AUTOGAS");
  const isCng = fuel.includes("CNG") || fuel === "GAS";

  // Country-aware ranges. These are intentionally generous, but remove broken
  // scrape values like 12.94 €/L diesel or unrealistically old/invalid records.
  if (country === "SI") {
    if (fuel === "ELKO") return price >= 0.9 && price <= 1.8;
    if (isPetrol95) return price >= 1.1 && price <= 2.3;
    if (isDiesel) return price >= 1.1 && price <= 2.3;
    if (isLpg) return price >= 0.45 && price <= 1.3;
  }

  if (country === "HR") {
    if (isPetrol95) return price >= 1.1 && price <= 2.3;
    if (isDiesel) return price >= 1.1 && price <= 2.3;
    if (isLpg) return price >= 0.45 && price <= 1.3;
  }

  if (country === "AT") {
    if (isPetrol95) return price >= 1.2 && price <= 2.5;
    if (isDiesel) return price >= 1.2 && price <= 2.5;
    if (isCng) return price >= 0.7 && price <= 2.5;
  }

  if (country === "IT") {
    if (isPetrol95) return price >= 1.3 && price <= 2.8;
    if (isDiesel) return price >= 1.3 && price <= 2.8;
    if (isLpg) return price >= 0.55 && price <= 1.5;
  }

  if (country === "HU") {
    if (isPetrol95) return price >= 1.1 && price <= 2.4;
    if (isDiesel) return price >= 1.1 && price <= 2.4;
    if (isLpg) return price >= 0.45 && price <= 1.4;
  }
  if (country === "DE") {
    if (isPetrol95) return price >= 1.2 && price <= 2.7;
    if (isDiesel) return price >= 1.2 && price <= 2.7;
  }

  // Fallback EU range.
  return price >= 0.45 && price <= 3.0;
}

function getPriceQuality(
  countryCode: string | null | undefined,
  fuelType: string,
  price: number,
  capturedAt: string | null | undefined,
): PriceQuality {
  const age = hoursSince(capturedAt);
  const price_age_hours = Number.isFinite(age) ? round(age, 2) : null;

  if (!isRealisticFuelPrice(countryCode, fuelType, price)) {
    return {
      price_age_hours,
      trusted_price: false,
      price_warning:
        "Cena je izven realnega razpona in ni uporabljena za priporočilo.",
    };
  }

  if (!Number.isFinite(age)) {
    return {
      price_age_hours,
      trusted_price: false,
      price_warning:
        "Manjka čas zajema cene, zato ni uporabljena za priporočilo.",
    };
  }

  if (age > MAX_PRICE_AGE_HOURS) {
    return {
      price_age_hours,
      trusted_price: false,
      price_warning: `Cena je starejša od ${MAX_PRICE_AGE_HOURS} ur in ni uporabljena za priporočilo.`,
    };
  }

  return {
    price_age_hours,
    trusted_price: true,
    price_warning: null,
  };
}

function withPriceQuality(row: Result): Result {
  const parsedPrice = Number(row.price);
  const price =
    Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null;

  if (price === null) {
    return {
      ...row,
      price: null,
      price_age_hours: null,
      trusted_price: false,
      price_warning:
        row.price_warning ||
        "Za to črpalko trenutno nimamo potrjene aktualne cene. Prikazana je zaradi bližine.",
    };
  }

  return {
    ...row,
    price,
    ...getPriceQuality(row.country_code, row.fuel_type, price, row.captured_at),
  };
}

type AustriaStation = {
  id: number;
  name: string;
  location?: {
    address?: string;
    postalCode?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
  };
  prices?: {
    fuelType?: string;
    amount?: number;
    label?: string;
  }[];
};

type RoutedResult = Result & {
  lat: number;
  lng: number;
  distance_km: number;
  estimated_drive_minutes: number;
  route_source: RouteSource;
  is_real_route: true;
};

type AnyResult = RoutedResult & {
  travel_fuel_cost: number | null;
  time_cost: number;
  effective_total_cost: number;
  tankaj_score: number;
  is_cross_border: boolean;
  recommendation_reason: string | null;
};

const INITIAL_PER_BUCKET = 5;
const COUNTRY_COVERAGE_LIMIT = 1;
const BRAND_COVERAGE_LIMIT = 1;
const INITIAL_CANDIDATE_LIMIT = 16;
const MORE_LIMIT = 5;
const ROUTING_CONCURRENCY = 8;
const CONSUMPTION_DEFAULT = 7;
const TIME_VALUE_DEFAULT = 12;
const ROUTE_CACHE_DAYS = 30;

function n(v: unknown, fallback = 0) {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

function round(v: number, decimals = 2) {
  return Number(v.toFixed(decimals));
}

function routeKeyCoord(value: number) {
  return Number(value.toFixed(4));
}

function normalizeBrand(value?: string | null) {
  return value ? value.trim().toUpperCase() : "";
}

function inferBrandKey(row: Pick<Result, "brand" | "name">) {
  const explicit = normalizeBrand(row.brand);
  if (explicit) return explicit;

  const name = normalizeBrand(row.name);
  const known = [
    "AGIP",
    "ARAL",
    "AVIA",
    "BP",
    "CRODUX",
    "DISCOUNT",
    "DISKONT",
    "ENI",
    "ESSO",
    "GENOL",
    "HEM",
    "HOFER",
    "INA",
    "IP",
    "JET",
    "LAGERHAUS",
    "MAXEN",
    "MOL",
    "OMV",
    "ORLEN",
    "PETROL",
    "Q8",
    "SHELL",
    "STAR",
    "TAMOIL",
    "TIFON",
    "TOTALENERGIES",
    "TURMOEL",
    "TURMÖL",
  ];

  return known.find((brand) => name.includes(brand)) || "";
}

function parseBrandSelection(value?: string | null) {
  const raw = String(value || "ALL").trim();
  if (!raw || normalizeBrand(raw) === "ALL") return [];

  return raw
    .split(",")
    .map((item) => normalizeBrand(item))
    .filter(Boolean)
    .filter((item) => item !== "ALL");
}

function brandValueMatches(
  row: Pick<Result, "brand" | "name" | "address">,
  selectedBrand: string,
) {
  const selected = normalizeBrand(selectedBrand);
  if (!selected || selected === "ALL") return true;

  const brand = normalizeBrand(row.brand);
  const name = normalizeBrand(row.name);
  const address = normalizeBrand(row.address);
  const inferred = inferBrandKey(row);
  const source = `${brand} ${name} ${address} ${inferred}`;

  if (selected === "HOFER") {
    return source.includes("HOFER") || source.includes("DISKONT");
  }

  if (selected === "DISKONT") {
    return source.includes("DISKONT") || source.includes("HOFER");
  }

  if (selected === "TURMOEL") {
    return source.includes("TURMÖL") || source.includes("TURMOEL");
  }

  return Boolean(
    brand === selected ||
    inferred === selected ||
    brand.includes(selected) ||
    selected.includes(brand) ||
    name.includes(selected) ||
    address.includes(selected),
  );
}

function hasBrandToken(text: string, brand: string) {
  return new RegExp(`(^|[^A-Z0-9])${brand}([^A-Z0-9]|$)`).test(text);
}

function brandMatches(
  row: Pick<Result, "brand" | "name" | "address">,
  selectedBrand: string,
) {
  if (!selectedBrand || selectedBrand === "ALL") return true;

  const selectedBrands = selectedBrand
    .split(",")
    .map((item) => normalizeBrand(item))
    .filter((item) => item && item !== "ALL");

  if (!selectedBrands.length) return true;

  const brand = normalizeBrand(row.brand);
  const name = normalizeBrand(row.name);
  const address = normalizeBrand(row.address);
  const inferred = inferBrandKey(row);

  const haystack = `${brand} ${name} ${address} ${inferred}`;

  return selectedBrands.some((selected) => {
    if (selected === "HOFER") {
      return hasBrandToken(name, "HOFER") || hasBrandToken(address, "HOFER");
    }

    if (selected === "SHELL") {
      return haystack.includes("SHELL");
    }

    if (selected === "OMV") {
      return haystack.includes("OMV");
    }

    if (selected === "ENI" || selected === "AGIP") {
      return haystack.includes("ENI") || haystack.includes("AGIP");
    }

    if (selected === "TURMOEL" || selected === "TURMÖL") {
      return haystack.includes("TURMÖL") || haystack.includes("TURMOEL");
    }

    return haystack.includes(selected);
  });
}

function countryMatches(
  rowCountry: string | null | undefined,
  selectedCountry: string,
) {
  if (!selectedCountry || selectedCountry === "ALL") return true;

  const row = String(rowCountry || "").toUpperCase();
  const selected = selectedCountry.toUpperCase();

  if (row === selected) return true;
  if (selected === "SI") return ["SI", "SLO", "SVN"].includes(row);
  if (selected === "HR") return ["HR", "HRV"].includes(row);
  if (selected === "AT") return ["AT", "AUT"].includes(row);
  if (selected === "IT") return ["IT", "ITA"].includes(row);
  if (selected === "HU") return ["HU", "HUN"].includes(row);
  if (selected === "DE") return ["DE", "DEU", "GER", "GERMANY"].includes(row);
  return false;
}

function inferUserCountry(lat: number, lng: number) {
  if (lat >= 47.2 && lat <= 55.2 && lng >= 5.5 && lng <= 15.5) return "DE";
  if (lat >= 46.3 && lat <= 49.2 && lng >= 9.4 && lng <= 17.3) return "AT";
  if (lat >= 45 && lat <= 47 && lng >= 13 && lng <= 17) return "SI";
  if (lat >= 42 && lat <= 47 && lng >= 13 && lng <= 20) return "HR";
  if (lat >= 35 && lat <= 48 && lng >= 6 && lng <= 19) return "IT";
  return null;
}

function hasCoords(r: Result): r is Result & { lat: number; lng: number } {
  return Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng));
}

function priceSortValue(price: number | null | undefined) {
  const value = Number(price);
  return Number.isFinite(value) && value > 0 ? value : 999;
}

function candidateScore(row: Result, amount: number) {
  return (
    priceSortValue(row.price) * amount + Number(row.distance_km || 999) * 0.35
  );
}

function uniqueByLocation(rows: Result[]) {
  const map = new Map<string, Result>();

  for (const row of rows) {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    const country = String(row.country_code || "").toUpperCase();
    const fuel = normalizeFuelKey(row.fuel_type);

    const coordKey =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? `${country}_${lat.toFixed(5)}_${lng.toFixed(5)}_${fuel}`
        : row.location_id;

    const shouldDeduplicateByCoords =
      (country === "AT" &&
        (row.source === "e-control.at" ||
          row.source === "fuel_prices_cache" ||
          row.location_id.startsWith("AT_"))) ||
      (country === "DE" &&
        (row.source === "tankerkoenig_live" ||
          row.source === "tankerkoenig" ||
          row.location_id.startsWith("DE_")));

    const key = shouldDeduplicateByCoords ? coordKey : row.location_id;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, row);
      continue;
    }

    const existingIsLive =
      existing.source === "tankerkoenig_live" ||
      existing.source === "e-control.at" ||
      existing.location_id.startsWith("DE_") ||
      existing.location_id.startsWith("AT_");

    const rowIsLive =
      row.source === "tankerkoenig_live" ||
      row.source === "e-control.at" ||
      row.location_id.startsWith("DE_") ||
      row.location_id.startsWith("AT_");

    if (rowIsLive && !existingIsLive) {
      map.set(key, row);
      continue;
    }

    const existingTime = new Date(existing.captured_at || 0).getTime();
    const rowTime = new Date(row.captured_at || 0).getTime();

    if (rowTime > existingTime) {
      map.set(key, row);
    }
  }

  return Array.from(map.values());
}

function buildInitialCandidatePool(rows: Result[], amount: number) {
  const smart = [...rows]
    .sort((a, b) => candidateScore(a, amount) - candidateScore(b, amount))
    .slice(0, INITIAL_PER_BUCKET);

  const cheapest = [...rows]
    .sort((a, b) => {
      const priceA = priceSortValue(a.price);
      const priceB = priceSortValue(b.price);
      if (priceA !== priceB) return priceA - priceB;
      return n(a.distance_km, 999) - n(b.distance_km, 999);
    })
    .slice(0, INITIAL_PER_BUCKET);

  const nearest = [...rows]
    .sort((a, b) => n(a.distance_km, 999) - n(b.distance_km, 999))
    .slice(0, INITIAL_PER_BUCKET);

  const byCountry = new Map<string, Result[]>();
  const byBrand = new Map<string, Result[]>();

  for (const row of rows) {
    const country = String(row.country_code || "UNKNOWN").toUpperCase();
    byCountry.set(country, [...(byCountry.get(country) || []), row]);

    const brand = inferBrandKey(row);
    if (brand) byBrand.set(brand, [...(byBrand.get(brand) || []), row]);
  }

  const coverage: Result[] = [];

  for (const group of byCountry.values()) {
    coverage.push(
      ...[...group]
        .sort((a, b) => n(a.distance_km, 999) - n(b.distance_km, 999))
        .slice(0, COUNTRY_COVERAGE_LIMIT),
    );
  }

  for (const group of byBrand.values()) {
    coverage.push(
      ...[...group]
        .sort((a, b) => n(a.distance_km, 999) - n(b.distance_km, 999))
        .slice(0, BRAND_COVERAGE_LIMIT),
    );
  }

  const mandatory = uniqueByLocation([...nearest, ...cheapest, ...coverage]);
  const optional = uniqueByLocation([...smart]);

  return uniqueByLocation([...mandatory, ...optional]).slice(
    0,
    INITIAL_CANDIDATE_LIMIT,
  );
}

function buildMoreCandidatePool(
  rows: Result[],
  amount: number,
  sortBy: SortBy,
  offset: number,
) {
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === "price") {
      const priceA = priceSortValue(a.price);
      const priceB = priceSortValue(b.price);
      if (priceA !== priceB) return priceA - priceB;
      return n(a.distance_km, 999) - n(b.distance_km, 999);
    }

    if (sortBy === "distance") {
      if (n(a.distance_km, 999) !== n(b.distance_km, 999)) {
        return n(a.distance_km, 999) - n(b.distance_km, 999);
      }

      return priceSortValue(a.price) - priceSortValue(b.price);
    }

    return candidateScore(a, amount) - candidateScore(b, amount);
  });

  return sorted.slice(offset, offset + MORE_LIMIT);
}

function mapAustriaFuelType(type: string): AustriaFuelType {
  const value = type.toUpperCase();

  if (
    value.includes("DIESEL") ||
    value.includes("DIE") ||
    value.includes("DIZEL")
  ) {
    return "DIE";
  }

  if (value.includes("CNG") || value.includes("GAS")) {
    return "GAS";
  }

  return "SUP";
}

function normalizeAustriaFuelType(fuel: AustriaFuelType) {
  if (fuel === "DIE") return "DIESEL";
  if (fuel === "SUP") return "PETROL_95";
  return "CNG";
}

function normalizeAustriaBrand(name?: string | null): string | null {
  const upper = String(name || "").toUpperCase();

  if (!upper) return null;

  if (upper.includes("OMV")) return "OMV";
  if (upper.includes("SHELL")) return "SHELL";
  if (upper.includes("JET")) return "JET";
  if (upper.includes("AVIA")) return "AVIA";
  if (upper.includes("ENI") || upper.includes("AGIP")) return "ENI";
  if (upper.includes("BP")) return "BP";
  if (upper.includes("TURMÖL") || upper.includes("TURMOEL")) return "TURMÖL";

  return null;
}

function getAustriaPrice(
  station: AustriaStation,
  fuel: AustriaFuelType,
): number | null {
  const prices = station.prices ?? [];
  const match = prices.find((price) => price.fuelType === fuel);

  if (typeof match?.amount === "number") return match.amount;

  return null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type TankerkoenigStation = {
  id: string;
  name: string;
  brand?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  postCode?: number | string | null;
  place?: string | null;
  lat: number;
  lng: number;
  dist?: number;
  e5?: number | null;
  e10?: number | null;
  diesel?: number | null;
  price?: number | null;
  isOpen?: boolean;
};

type TankerkoenigResponse = {
  ok: boolean;
  stations?: TankerkoenigStation[];
  message?: string;
  data?: string;
};

function mapGermanyFuelPrice(station: TankerkoenigStation, type: string) {
  const fuel = normalizeFuelKey(type);

  if (fuel === "DIESEL") return Number(station.diesel ?? station.price);
  if (fuel === "PETROL_E10") return Number(station.e10 ?? station.price);

  return Number(station.e5 ?? station.price);
}

function buildGermanyAddress(station: TankerkoenigStation) {
  return (
    [station.street, station.houseNumber].filter(Boolean).join(" ").trim() ||
    null
  );
}

function germanyCacheKey(
  lat: number,
  lng: number,
  radius: number,
  type: string,
) {
  return [
    "germany_search",
    lat.toFixed(2),
    lng.toFixed(2),
    Math.min(Math.max(Math.round(radius), 1), 25),
    normalizeFuelKey(type),
  ].join(":");
}

async function readGermanyCachedRows(
  cacheKey: string,
): Promise<Result[] | null> {
  const since = new Date(
    Date.now() - GERMANY_CACHE_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("ingest_cache")
    .select("payload,updated_at")
    .eq("cache_key", cacheKey)
    .gte("updated_at", since)
    .maybeSingle();

  if (error || !data) return null;

  const rows = (data.payload as { rows?: Result[] } | null)?.rows;

  return Array.isArray(rows) ? rows : null;
}

async function writeGermanyCachedRows(cacheKey: string, rows: Result[]) {
  await supabase.from("ingest_cache").upsert(
    {
      cache_key: cacheKey,
      source: "tankerkoenig_search",
      payload: {
        rows,
        cached_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cache_key" },
  );
}

async function fetchGermanyRows(
  lat: number,
  lng: number,
  radius: number,
  type: string,
): Promise<Result[]> {
  if (!TANKERKOENIG_API_KEY) return [];

  const safeRadius = Math.min(Math.max(radius, 1), 25);
  const cacheKey = germanyCacheKey(lat, lng, safeRadius, type);

  const cachedRows = await readGermanyCachedRows(cacheKey);
  if (cachedRows) return cachedRows;

  const url = new URL("https://creativecommons.tankerkoenig.de/json/list.php");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("rad", String(safeRadius));
  url.searchParams.set("sort", "dist");
  url.searchParams.set(
    "type",
    normalizeFuelKey(type) === "DIESEL"
      ? "diesel"
      : normalizeFuelKey(type) === "PETROL_E10"
        ? "e10"
        : "e5",
  );
  url.searchParams.set("apikey", TANKERKOENIG_API_KEY);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "Tankaj.si Germany on-demand search",
      },
      cache: "no-store",
    });

    const json = (await res.json()) as TankerkoenigResponse;

    if (!res.ok || !json.ok) {
      console.warn("Tankerkönig search failed", {
        status: res.status,
        message: json.message ?? json.data ?? "unknown",
      });

      return [];
    }

    const capturedAt = new Date().toISOString();

    const rows = (json.stations || [])
      .map((station): Result | null => {
        const stationLat = Number(station.lat);
        const stationLng = Number(station.lng);
        const price = Number(
          station.price ?? mapGermanyFuelPrice(station, type),
        );

        if (
          !station.id ||
          !Number.isFinite(stationLat) ||
          !Number.isFinite(stationLng) ||
          !Number.isFinite(price) ||
          price <= 0
        ) {
          return null;
        }

        return {
          location_id: `DE_${station.id}`,
          name: station.name || station.brand || "Tankstelle",
          brand: station.brand || null,
          address: buildGermanyAddress(station),
          city: station.place || null,
          country_code: "DE",
          lat: stationLat,
          lng: stationLng,
          distance_km: round(haversineKm(lat, lng, stationLat, stationLng)),
          estimated_drive_minutes: null,
          fuel_type: normalizeFuelKey(type),
          price,
          fuel_cost: null,
          source: "tankerkoenig_live",
          captured_at: capturedAt,
        };
      })
      .filter((row): row is Result => row !== null)
      .filter((row) => row.distance_km <= safeRadius)
      .map(withPriceQuality)
      .filter((row) => row.trusted_price === true);

    await writeGermanyCachedRows(cacheKey, rows);

    return rows;
  } catch (error) {
    console.warn("Tankerkönig search error", error);
    return [];
  }
}

async function fetchAustriaRows(
  lat: number,
  lng: number,
  type: string,
): Promise<Result[]> {
  const fuel = mapAustriaFuelType(type);
  const capturedAt = new Date().toISOString();

  const gridKm = 8;
  const latDelta = gridKm / 111;
  const lngDelta = gridKm / (111 * Math.cos((lat * Math.PI) / 180));

  const points = [
    { lat, lng },
    { lat: lat + latDelta, lng },
    { lat: lat - latDelta, lng },
    { lat, lng: lng + lngDelta },
    { lat, lng: lng - lngDelta },
    { lat: lat + latDelta, lng: lng + lngDelta },
    { lat: lat + latDelta, lng: lng - lngDelta },
    { lat: lat - latDelta, lng: lng + lngDelta },
    { lat: lat - latDelta, lng: lng - lngDelta },
    { lat: lat + latDelta * 2, lng },
    { lat: lat - latDelta * 2, lng },
    { lat, lng: lng + lngDelta * 2 },
    { lat, lng: lng - lngDelta * 2 },
  ];

  async function fetchPoint(point: { lat: number; lng: number }) {
    const url = new URL(
      "https://api.e-control.at/sprit/1.0/search/gas-stations/by-address",
    );

    url.searchParams.set("latitude", String(point.lat));
    url.searchParams.set("longitude", String(point.lng));
    url.searchParams.set("fuelType", fuel);
    url.searchParams.set("includeClosed", "false");

    try {
      const res = await fetch(url.toString(), {
        headers: {
          accept: "application/json",
          "user-agent": "Tankaj.si fuel price search",
        },
        cache: "no-store",
      });

      if (!res.ok) return [];

      return (await res.json()) as AustriaStation[];
    } catch {
      return [];
    }
  }

  const responses = await Promise.all(points.map(fetchPoint));
  const stations = responses.flat();
  const unique = new Map<number, AustriaStation>();

  for (const station of stations) {
    if (!station?.id) continue;
    if (!unique.has(station.id)) unique.set(station.id, station);
  }

  return Array.from(unique.values())
    .map((station): Result | null => {
      if (!station?.name) return null;

      const price = getAustriaPrice(station, fuel);

      if (price === null) return null;

      const stationLat = station.location?.latitude;
      const stationLng = station.location?.longitude;

      if (typeof stationLat !== "number" || typeof stationLng !== "number") {
        return null;
      }

      return {
        location_id: `AT_${station.id}`,
        name: station.name,
        brand: normalizeAustriaBrand(station.name),
        address: station.location?.address ?? null,
        city: station.location?.city ?? null,
        country_code: "AT",
        lat: stationLat,
        lng: stationLng,
        distance_km: round(haversineKm(lat, lng, stationLat, stationLng)),
        estimated_drive_minutes: null,
        fuel_type: normalizeAustriaFuelType(fuel),
        price,
        fuel_cost: null,
        source: "e-control.at",
        captured_at: capturedAt,
      };
    })
    .filter((item): item is Result => item !== null);
}

async function saveAustriaLivePrices(rows: Result[]) {
  const pricedRows = rows.filter(
    (row) =>
      row.country_code === "AT" &&
      row.source === "e-control.at" &&
      row.location_id?.startsWith("AT_") &&
      Number.isFinite(Number(row.price)) &&
      row.trusted_price !== false &&
      Number.isFinite(Number(row.lat)) &&
      Number.isFinite(Number(row.lng)),
  );

  if (!pricedRows.length) return;

  const sourceIds = Array.from(
    new Set(pricedRows.map((row) => row.location_id.replace("AT_", ""))),
  );

  const { data: existingLocations } = await supabase
    .from("locations")
    .select("id,source_id")
    .eq("country_code", "AT")
    .eq("source", "e-control.at")
    .in("source_id", sourceIds);

  const existingBySourceId = new Map(
    (existingLocations || []).map((loc) => [String(loc.source_id), loc.id]),
  );

  const missingLocations = pricedRows
    .filter(
      (row) => !existingBySourceId.has(row.location_id.replace("AT_", "")),
    )
    .map((row) => ({
      type: "fuel_station",
      name: row.name,
      brand: row.brand,
      operator: row.brand,
      address: row.address,
      city: row.city,
      country_code: "AT",
      lat: row.lat,
      lng: row.lng,
      geo: `POINT(${row.lng} ${row.lat})`,
      source: "e-control.at",
      source_id: row.location_id.replace("AT_", ""),
      is_active: true,
      metadata: {
        imported_from_live_search: true,
      },
    }));

  if (missingLocations.length) {
    await supabase.from("locations").upsert(missingLocations, {
      onConflict: "source,source_id",
    });
  }

  const { data: allLocations } = await supabase
    .from("locations")
    .select("id,source_id")
    .eq("country_code", "AT")
    .eq("source", "e-control.at")
    .in("source_id", sourceIds);

  const locationIdBySourceId = new Map(
    (allLocations || []).map((loc) => [String(loc.source_id), loc.id]),
  );

  const pricePayload: {
    location_id: string;
    fuel_type: string;
    price: number;
    currency: string;
    source: string;
    source_updated_at: string;
    captured_at: string;
  }[] = [];

  for (const row of pricedRows) {
    const sourceId = row.location_id.replace("AT_", "");
    const fallbackLocationId = locationIdBySourceId.get(sourceId);

    if (!fallbackLocationId) continue;

    const rowLat = Number(row.lat);
    const rowLng = Number(row.lng);

    const latDelta = 0.003;
    const lngDelta = 0.003;

    const { data: nearbyOsmLocations } = await supabase
      .from("locations")
      .select("id,name,brand,address,city,lat,lng,source")
      .eq("country_code", "AT")
      .eq("source", "openstreetmap_at")
      .eq("is_active", true)
      .gte("lat", rowLat - latDelta)
      .lte("lat", rowLat + latDelta)
      .gte("lng", rowLng - lngDelta)
      .lte("lng", rowLng + lngDelta)
      .limit(10);

    const normalizedRowBrand = normalizeBrand(row.brand || row.name);
    const normalizedRowName = normalizeBrand(row.name);
    const normalizedRowAddress = normalizeBrand(row.address);

    const matchedOsm = (nearbyOsmLocations || [])
      .map((loc: any) => {
        const locLat = Number(loc.lat);
        const locLng = Number(loc.lng);

        if (!Number.isFinite(locLat) || !Number.isFinite(locLng)) {
          return null;
        }

        const distanceKm = haversineKm(rowLat, rowLng, locLat, locLng);
        const locBrand = normalizeBrand(loc.brand || loc.name);
        const locName = normalizeBrand(loc.name);
        const locAddress = normalizeBrand(loc.address);

        const sameBrand =
          normalizedRowBrand &&
          locBrand &&
          (normalizedRowBrand.includes(locBrand) ||
            locBrand.includes(normalizedRowBrand) ||
            normalizedRowName.includes(locBrand) ||
            locName.includes(normalizedRowBrand));

        const sameAddress =
          normalizedRowAddress &&
          locAddress &&
          (normalizedRowAddress.includes(locAddress) ||
            locAddress.includes(normalizedRowAddress));

        const score =
          distanceKm * 1000 - (sameBrand ? 80 : 0) - (sameAddress ? 60 : 0);

        return {
          ...loc,
          distanceKm,
          sameBrand,
          sameAddress,
          score,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.score - b.score)[0];

    const shouldUseOsmLocation =
      matchedOsm &&
      (matchedOsm.distanceKm <= 0.08 ||
        (matchedOsm.distanceKm <= 0.15 && matchedOsm.sameBrand) ||
        (matchedOsm.distanceKm <= 0.2 && matchedOsm.sameAddress));

    const locationIdToUse = shouldUseOsmLocation
      ? matchedOsm.id
      : fallbackLocationId;

    const capturedAt = row.captured_at || new Date().toISOString();

    pricePayload.push({
      location_id: locationIdToUse,
      fuel_type: row.fuel_type,
      price: Number(row.price),
      currency: "EUR",
      source: "e-control.at",
      source_updated_at: capturedAt,
      captured_at: capturedAt,
    });
  }

  if (!pricePayload.length) return;

  await supabase.from("fuel_prices").upsert(pricePayload, {
    onConflict: "location_id,fuel_type,source",
  });
}

async function fetchAustriaDbRows(
  lat: number,
  lng: number,
  radius: number,
  type: string,
): Promise<Result[]> {
  const safeRadius = Math.min(Math.max(radius, 1), 300);
  const latDelta = safeRadius / 111;
  const lngDelta = safeRadius / (111 * Math.cos((lat * Math.PI) / 180));

  const { data, error } = await supabase
    .from("locations")
    .select(
      `
      id,
      name,
      brand,
      address,
      city,
      country_code,
      lat,
      lng,
      source,
      source_id,
      fuel_prices (
        fuel_type,
        price,
        captured_at
      )
    `,
    )
    .eq("country_code", "AT")
    .gte("lat", lat - latDelta)
    .lte("lat", lat + latDelta)
    .gte("lng", lng - lngDelta)
    .lte("lng", lng + lngDelta)
    .limit(700);

  if (error || !data) return [];

  return data
    .map((loc: any): Result | null => {
      const locLat = Number(loc.lat);
      const locLng = Number(loc.lng);

      if (!Number.isFinite(locLat) || !Number.isFinite(locLng)) return null;

      const distance = haversineKm(lat, lng, locLat, locLng);
      if (distance > safeRadius) return null;

      const priceRow = (loc.fuel_prices || []).find(
        (p: any) => normalizeFuelKey(p.fuel_type) === normalizeFuelKey(type),
      );

      const price = Number(priceRow?.price);
      if (!Number.isFinite(price) || price <= 0) return null;

      return {
        location_id:
          loc.source === "e-control.at" && loc.source_id
            ? `AT_${loc.source_id}`
            : String(loc.id),
        name: loc.name || "Bencinski servis",
        brand: loc.brand || null,
        address: loc.address || null,
        city: loc.city || null,
        country_code: "AT",
        lat: locLat,
        lng: locLng,
        distance_km: round(distance),
        estimated_drive_minutes: null,
        fuel_type: type,
        price,
        fuel_cost: null,
        source: "fuel_prices_cache",
        captured_at: priceRow.captured_at,
      };
    })
    .filter((item): item is Result => item !== null);
}

async function fetchAustriaOsmRows(
  lat: number,
  lng: number,
  radius: number,
  type: string,
): Promise<Result[]> {
  const safeRadius = Math.min(Math.max(radius, 1), 300);
  const latDelta = safeRadius / 111;
  const lngDelta = safeRadius / (111 * Math.cos((lat * Math.PI) / 180));

  const { data, error } = await supabase
    .from("locations")
    .select(
      "id,name,brand,address,city,country_code,lat,lng,source,source_id,updated_at,is_active",
    )
    .eq("country_code", "AT")
    .eq("source", "openstreetmap_at")
    .eq("is_active", true)
    .gte("lat", lat - latDelta)
    .lte("lat", lat + latDelta)
    .gte("lng", lng - lngDelta)
    .lte("lng", lng + lngDelta)
    .limit(700);

  if (error || !data) return [];

  return data
    .map((row): Result | null => {
      const rowLat = Number(row.lat);
      const rowLng = Number(row.lng);

      if (!Number.isFinite(rowLat) || !Number.isFinite(rowLng)) return null;

      const distance = haversineKm(lat, lng, rowLat, rowLng);
      if (distance > safeRadius) return null;

      return {
        location_id: String(row.id),
        name: row.name || "Bencinski servis",
        brand: row.brand || null,
        address: row.address || null,
        city: row.city || null,
        country_code: "AT",
        lat: rowLat,
        lng: rowLng,
        distance_km: round(distance),
        estimated_drive_minutes: null,
        fuel_type: type,
        price: null,
        fuel_cost: null,
        source: "openstreetmap_at",
        captured_at: null,
        trusted_price: false,
        price_age_hours: null,
        price_warning:
          "Za to črpalko trenutno nimamo potrjene aktualne cene. Prikazana je zaradi bližine.",
      };
    })
    .filter((item): item is Result => item !== null);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

async function getCachedRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const { data, error } = await supabase
    .from("route_cache")
    .select("distance_km,duration_min,route_source")
    .eq("from_lat_rounded", routeKeyCoord(from.lat))
    .eq("from_lng_rounded", routeKeyCoord(from.lng))
    .eq("to_lat_rounded", routeKeyCoord(to.lat))
    .eq("to_lng_rounded", routeKeyCoord(to.lng))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;

  return {
    distance_km: Number(data.distance_km),
    duration_min: Number(data.duration_min),
    route_source:
      data.route_source === "osrm"
        ? ("osrm" as const)
        : ("openrouteservice" as const),
  };
}

async function saveCachedRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  route: {
    distance_km: number;
    duration_min: number;
    route_source: RouteSource;
  },
) {
  await supabase.from("route_cache").upsert(
    {
      from_lat_rounded: routeKeyCoord(from.lat),
      from_lng_rounded: routeKeyCoord(from.lng),
      to_lat_rounded: routeKeyCoord(to.lat),
      to_lng_rounded: routeKeyCoord(to.lng),
      distance_km: round(route.distance_km),
      duration_min: Math.round(route.duration_min),
      route_source: route.route_source,
      expires_at: new Date(
        Date.now() + ROUTE_CACHE_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    },
    {
      onConflict:
        "from_lat_rounded,from_lng_rounded,to_lat_rounded,to_lng_rounded",
    },
  );
}

async function getOsrm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`,
      {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!res.ok) throw new Error(`OSRM failed: ${res.status}`);

    const json = await res.json();
    const route = json?.routes?.[0];

    if (!route?.distance || !route?.duration) {
      throw new Error("OSRM returned no route");
    }

    return {
      distance_km: route.distance / 1000,
      duration_min: route.duration / 60,
      route_source: "osrm" as const,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const cached = await getCachedRoute(from, to);
  if (cached) return cached;

  try {
    const finalRoute = await getOsrm(from, to);
    await saveCachedRoute(from, to, finalRoute);
    return finalRoute;
  } catch {
    const route = await getDrivingDistance(from, to);

    const finalRoute = {
      distance_km: route.distance_km,
      duration_min: route.duration_min,
      route_source: "openrouteservice" as const,
    };

    await saveCachedRoute(from, to, finalRoute);
    return finalRoute;
  }
}

async function enrich(rows: Result[], user: { lat: number; lng: number }) {
  const candidates = rows.filter(hasCoords);

  const routed = await mapWithConcurrency(
    candidates,
    ROUTING_CONCURRENCY,
    async (r) => {
      try {
        const to = { lat: Number(r.lat), lng: Number(r.lng) };
        const route = await getRoute(user, to);

        return {
          ...r,
          lat: to.lat,
          lng: to.lng,
          distance_km: round(route.distance_km),
          estimated_drive_minutes: Math.max(1, Math.round(route.duration_min)),
          route_source: route.route_source,
          is_real_route: true as const,
        };
      } catch {
        return null;
      }
    },
  );

  return routed.filter(Boolean) as RoutedResult[];
}

function score(
  rows: RoutedResult[],
  amount: number,
  consumption: number,
  timeValue: number,
  userCountry: string | null,
) {
  return rows.map((r) => {
    const existingFuelCost =
      typeof r.fuel_cost === "number" &&
      Number.isFinite(r.fuel_cost) &&
      r.fuel_cost > 0
        ? r.fuel_cost
        : typeof r.total_cost === "number" &&
            Number.isFinite(r.total_cost) &&
            r.total_cost > 0
          ? r.total_cost
          : null;

    const price =
      priceSortValue(r.price) === 999 ? null : priceSortValue(r.price);
    const fuelCost =
      price !== null ? round(existingFuelCost ?? price * amount) : null;
    const travelFuelCost =
      price !== null
        ? round((r.distance_km * consumption * price) / 100)
        : null;
    const timeCost = round((r.estimated_drive_minutes / 60) * timeValue);
    const effectiveTotalCost =
      fuelCost !== null && travelFuelCost !== null
        ? round(fuelCost + travelFuelCost + timeCost)
        : 999999;

    return {
      ...r,
      fuel_cost: fuelCost,
      travel_fuel_cost: travelFuelCost,
      time_cost: timeCost,
      effective_total_cost: effectiveTotalCost,
      tankaj_score: effectiveTotalCost,
      is_cross_border: userCountry
        ? Boolean(r.country_code && r.country_code !== userCountry)
        : false,
      recommendation_reason: null,
    };
  });
}

function sortResults(rows: AnyResult[], sortBy: SortBy) {
  return [...rows].sort((a, b) => {
    if (sortBy === "price") {
      const priceA = priceSortValue(a.price);
      const priceB = priceSortValue(b.price);
      if (priceA !== priceB) return priceA - priceB;
      if (a.distance_km !== b.distance_km) return a.distance_km - b.distance_km;
      return a.effective_total_cost - b.effective_total_cost;
    }

    if (sortBy === "distance") {
      if (a.distance_km !== b.distance_km) return a.distance_km - b.distance_km;
      const priceA = priceSortValue(a.price);
      const priceB = priceSortValue(b.price);
      if (priceA !== priceB) return priceA - priceB;
      return a.effective_total_cost - b.effective_total_cost;
    }

    if (a.tankaj_score !== b.tankaj_score)
      return a.tankaj_score - b.tankaj_score;
    return a.distance_km - b.distance_km;
  });
}

function pickWinner(rows: AnyResult[], sortBy: SortBy, radius: number) {
  const insideRadius = rows.filter((r) => r.distance_km <= radius);
  if (!insideRadius.length) return null;

  const winner = sortResults(insideRadius, sortBy)[0];

  return {
    ...winner,
    recommendation_reason:
      sortBy === "price"
        ? "Najcenejša opcija v izbranem radiusu."
        : sortBy === "distance"
          ? "Najbližja črpalka po realni poti."
          : "Najboljša kombinacija cene, poti in časa.",
  };
}

function countByCountry(rows: { country_code?: string | null }[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.country_code || "UNKNOWN").toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radius = Number(searchParams.get("radius") || 25);
  const amount = Number(searchParams.get("amount") || 50);
  const type =
    searchParams.get("type") ||
    searchParams.get("fuel_type") ||
    searchParams.get("fuelType") ||
    searchParams.get("fuel") ||
    "PETROL_95";

  const consumption = Number(
    searchParams.get("consumption") || CONSUMPTION_DEFAULT,
  );
  const timeValue = Number(searchParams.get("timeValue") || TIME_VALUE_DEFAULT);

  const requestedSortBy = searchParams.get("sortBy") || "smart";
  const sortBy: SortBy =
    requestedSortBy === "price" || requestedSortBy === "distance"
      ? requestedSortBy
      : "smart";

  const batch: Batch =
    searchParams.get("batch") === "more" ? "more" : "initial";
  const offset = Math.max(
    0,
    Number(searchParams.get("offset") || INITIAL_PER_BUCKET),
  );

  const brandFilter = normalizeBrand(
    searchParams.get("brand") || searchParams.get("brandFilter"),
  );
  const countryFilter = searchParams.get("country") || "ALL";

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { success: false, error: "Missing or invalid coords" },
      { status: 400 },
    );
  }

  if (!Number.isFinite(radius) || radius <= 0) {
    return NextResponse.json(
      { success: false, error: "Missing or invalid radius" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("search_fuel_locations", {
    user_lat: lat,
    user_lng: lng,
    radius_km: radius,
    wanted_fuel_type: type,
    amount,
    car_consumption_l_per_100km: consumption,
    avg_speed_kmh: 55,
    time_value_eur_per_hour: timeValue,
  });

  if (error) {
    return NextResponse.json({ success: false, error }, { status: 500 });
  }

  const userCountry = inferUserCountry(lat, lng);

  const dbRows = ((data || []) as Result[])
    .filter(hasCoords)
    .map(withPriceQuality);

  const shouldUseAustria = countryFilter === "ALL" || countryFilter === "AT";

  const austriaDbRows = shouldUseAustria
    ? (await fetchAustriaDbRows(lat, lng, radius, type))
        .filter(hasCoords)
        .map(withPriceQuality)
    : [];

  const austriaLiveRows = shouldUseAustria
    ? (await fetchAustriaRows(lat, lng, type))
        .filter(hasCoords)
        .map(withPriceQuality)
    : [];

  await saveAustriaLivePrices(austriaLiveRows);

  const austriaOsmRows = shouldUseAustria
    ? (await fetchAustriaOsmRows(lat, lng, radius, type))
        .filter(hasCoords)
        .map(withPriceQuality)
    : [];

  const austriaRows = uniqueByLocation([
    ...austriaLiveRows,
    ...austriaDbRows,
    ...austriaOsmRows,
  ]);

  const shouldUseGermany =
    countryFilter === "DE" || (countryFilter === "ALL" && userCountry === "DE");

  const germanyRows = shouldUseGermany
    ? (await fetchGermanyRows(lat, lng, radius, type))
        .filter(hasCoords)
        .map(withPriceQuality)
    : [];

  let rows = uniqueByLocation([...germanyRows, ...dbRows, ...austriaRows]).map(
    withPriceQuality,
  );

  if (brandFilter && brandFilter !== "ALL") {
    rows = rows.filter((r) => brandMatches(r, brandFilter));
  }

  if (countryFilter && countryFilter !== "ALL") {
    rows = rows.filter((r) => countryMatches(r.country_code, countryFilter));
  }

  // IMPORTANT: only stations with a fresh, realistic price may be shown.
  // OSM locations without a confirmed fuel price are used only for future coverage/matching,
  // not as visible results, because Tankaj.si must recommend priced stations only.
  const trustedRows = rows.filter((r) => r.trusted_price === true);
  const fallbackRows = rows.filter((r) => r.trusted_price !== true);

  const trustedCandidatePool =
    batch === "more"
      ? buildMoreCandidatePool(trustedRows, amount, sortBy, offset)
      : buildInitialCandidatePool(trustedRows, amount);

  const fallbackCandidatePool: Result[] = [];
  const candidatePool = uniqueByLocation(trustedCandidatePool);

  const routed = await enrich(candidatePool, { lat, lng });
  const scored = score(routed, amount, consumption, timeValue, userCountry);

  const valid = scored.filter(
    (r) =>
      r.is_real_route &&
      Number.isFinite(r.distance_km) &&
      Number.isFinite(r.estimated_drive_minutes) &&
      Number.isFinite(r.effective_total_cost),
  );

  const validTrusted = valid.filter((r) => r.trusted_price === true);
  const validFallback = valid.filter((r) => r.trusted_price !== true);

  // Winner and visible results may only come from fresh and realistic prices.
  const winner = pickWinner(validTrusted, sortBy, radius);

  const results = sortResults(
    validTrusted.filter((r) => r.distance_km <= radius),
    sortBy,
  );

  const nextOffset =
    batch === "more" ? offset + MORE_LIMIT : candidatePool.length;
  const hasMore = trustedRows.length > nextOffset;

  return NextResponse.json({
    success: true,
    batch,
    ranking: sortBy,
    winner,
    results,
    has_more: hasMore,
    next_offset: nextOffset,
    price_policy: {
      max_price_age_hours: MAX_PRICE_AGE_HOURS,
      winner_requires_trusted_price: true,
      visible_results_require_trusted_price: true,
      fallback_results_are_display_only: false,
    },
    counts: {
      all_considered_count: rows.length,
      db_count: dbRows.length,
      austria_count: austriaRows.length,
      austria_db_count: austriaDbRows.length,
      austria_live_count: austriaLiveRows.length,
      austria_osm_count: austriaOsmRows.length,
      germany_live_count: germanyRows.length,
      trusted_rows_count: trustedRows.length,
      fallback_rows_count: fallbackRows.length,
      candidate_pool_count: candidatePool.length,
      trusted_candidate_pool_count: trustedCandidatePool.length,
      fallback_candidate_pool_count: fallbackCandidatePool.length,
      routed_count: routed.length,
      valid_count: valid.length,
      valid_trusted_count: validTrusted.length,
      valid_fallback_count: validFallback.length,
      results_count: results.length,
      rows_by_country: countByCountry(rows),
      valid_by_country: countByCountry(valid),
      country_filter: countryFilter,
    },
  });
}
