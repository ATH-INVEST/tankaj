"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";

type SearchMode = "fuel" | "ev";
type SearchStatus = "idle" | "location" | "routing" | "done" | "error";
type SortBy = "smart" | "price" | "distance";
type EvChargingMode = "DC" | "AC";
type Result = {
  location_id: string;
  name: string;
  brand: string | null;
  operator?: string | null;
  address: string | null;
  city: string | null;
  country_code?: string | null;
  lat: number;
  lng: number;
  distance_km: number;
  estimated_drive_minutes: number;
  fuel_type: string;
  price: number | null;
  price_unit?: string | null;
  fuel_cost: number | null;
  travel_fuel_cost: number | null;
  time_cost: number | null;
  effective_total_cost: number | null;
  tankaj_score?: number;
  is_cross_border?: boolean;
  route_source?: string;
  source?: string | null;
  captured_at?: string;
  price_age_hours?: number | null;
  trusted_price?: boolean;
  price_warning?: string | null;
  recommendation_reason?: string | null;
  max_power_kw?: number | null;
  connector_types?: string[] | null;
  power_type?: string | null;
  is_verified?: boolean;
  price_confidence?: string | null;
  price_source_name?: string | null;
  price_source_url?: string | null;
  tariff_note?: string | null;
  base_price?: number | null;
  applied_tariff_id?: string | null;
  applied_tariff_name?: string | null;
  applied_tariff_price?: number | null;
  subscription_tariffs?: EvSubscriptionTariff[] | null;
};

type EvSubscriptionTariff = {
  id: string;
  provider: string;
  name: string;
  price: number;
  countries: string[];
  note: string;
};

type GeocodeResult = {
  label: string;
  lat: number;
  lng: number;
  country_code?: string | null;
};

type Preferences = {
  mode?: SearchMode;
  fuelType?: string;
  radius?: number;
  amount?: number;
  brand?: string;
  country?: string;
  sortBy?: SortBy;
  includeFuel?: boolean;
  includePath?: boolean;
  includeTime?: boolean;
  evChargingMode?: EvChargingMode;
  evAmountKwh?: number;
  evMinPowerKw?: number;
  evConsumptionKwh100?: number;
  useEvSubscriptionPrices?: boolean;
};

const STORAGE_KEY = "tankaj_preferences_v2";

const SORT_OPTIONS_FUEL: [SortBy, string][] = [
  ["smart", "Priporočeno"],
  ["price", "Najcenejše €/L"],
  ["distance", "Najbližje"],
];

const SORT_OPTIONS_EV: [SortBy, string][] = [
  ["smart", "Priporočeno"],
  ["price", "Najcenejše €/kWh"],
  ["distance", "Najbližje"],
];

const COUNTRY_OPTIONS = [
  ["ALL", "Vse države"],
  ["SI", "Slovenija"],
  ["HR", "Hrvaška"],
  ["AT", "Avstrija"],
  ["IT", "Italija"],
];

function formatMoney(value?: number | null) {
  if (!Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(2)} €`;
}

function hasUsablePrice(item?: Pick<Result, "price"> | null) {
  return Number.isFinite(Number(item?.price)) && Number(item?.price) > 0;
}

function formatUnitPrice(
  item: Pick<Result, "price" | "price_unit" | "fuel_type">,
) {
  if (!hasUsablePrice(item)) return "Cena ni na voljo";
  return `${Number(item.price).toFixed(isEv(item) ? 2 : 3)} ${unitLabel(item)}`;
}

function hasCost(value?: number | null) {
  return Number.isFinite(Number(value)) && Number(value) < 999999;
}

function formatCost(value?: number | null) {
  return hasCost(value) ? formatMoney(value) : "—";
}

function formatKm(value?: number | null) {
  return `${Number(value || 0)
    .toFixed(2)
    .replace(".00", "")} km`;
}

function normalize(value?: string | null) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

const PREMIUM_BRAND_PRIORITY = [
  "OMV",
  "SHELL",
  "ENI",
  "AGIP",
  "BP",
  "HOFER",
  "DISKONT",
  "AVIA",
  "JET",
  "TURMÖL",
  "TURMOEL",
  "GENOL",
  "LAGERHAUS",
];

function isEv(item?: Pick<Result, "fuel_type"> | null) {
  return Boolean(item && normalize(item.fuel_type).startsWith("EV_"));
}

function unitLabel(item?: Pick<Result, "price_unit" | "fuel_type"> | null) {
  if (!item) return "€/L";
  if (item.price_unit) return item.price_unit;
  return isEv(item) ? "€/kWh" : "€/L";
}

function countryLabel(code?: string | null) {
  return code ? code.toUpperCase() : "—";
}

function normalizeFuelForMerge(value?: string | null) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function resultMergeKey(item: Result) {
  const lat = Number(item.lat);
  const lng = Number(item.lng);
  const country = normalize(item.country_code);
  const fuel = normalizeFuelForMerge(item.fuel_type);

  if (
    country === "AT" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    (item.source === "e-control.at" ||
      item.source === "fuel_prices_cache" ||
      item.location_id.startsWith("AT_"))
  ) {
    return `${country}_${lat.toFixed(5)}_${lng.toFixed(5)}_${fuel}`;
  }

  return item.location_id;
}

function mergeUniqueResults(existing: Result[], incoming: Result[]) {
  const map = new Map<string, Result>();

  for (const item of existing) {
    map.set(resultMergeKey(item), item);
  }

  for (const item of incoming) {
    const key = resultMergeKey(item);
    const previous = map.get(key);

    if (!previous) {
      map.set(key, item);
      continue;
    }

    const previousTime = new Date(previous.captured_at || 0).getTime();
    const itemTime = new Date(item.captured_at || 0).getTime();

    if (itemTime >= previousTime) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}

function brandShort(brand?: string | null) {
  const b = normalize(brand);
  if (!b || b.includes("UNKNOWN")) return "EV";
  if (b.includes("PETROL")) return "P";
  if (b.includes("SHELL")) return "SH";
  if (b.includes("BP")) return "BP";
  if (b.includes("HOFER")) return "HOF";
  if (b.includes("DISKONT")) return "DIS";
  if (b.includes("GENOL")) return "GEN";
  if (b.includes("LAGERHAUS")) return "LAG";
  if (b.includes("MOL")) return "MOL";
  if (b.includes("INA")) return "INA";
  if (b.includes("TIFON")) return "TF";
  if (b.includes("CRODUX")) return "CR";
  if (b.includes("OMV")) return "OMV";
  if (b.includes("ENI")) return "ENI";
  if (b.includes("Q8")) return "Q8";
  if (b.includes("IP")) return "IP";
  if (b.includes("TAMOIL")) return "TA";
  if (b.includes("ESSO")) return "ES";
  if (b.includes("TOTAL")) return "TE";
  if (b.includes("TESLA")) return "⚡";
  if (b.includes("LIDL")) return "L";
  return b.slice(0, 3);
}

function brandColor(brand?: string | null) {
  const b = normalize(brand);
  if (b.includes("PETROL")) return "bg-[#ee1b2f] text-white";
  if (b.includes("MOL")) return "bg-[#c8192e] text-white";
  if (b.includes("SHELL")) return "bg-[#ffd84d] text-[#7a1600]";
  if (b.includes("OMV")) return "bg-white text-[#007a5e]";
  if (b.includes("BP")) return "bg-[#009fdf] text-white";
  if (b.includes("HOFER") || b.includes("DISKONT"))
    return "bg-[#ffd84d] text-[#071a12]";
  if (b.includes("GENOL") || b.includes("LAGERHAUS"))
    return "bg-white/90 text-[#0b1f16]";
  if (b.includes("INA")) return "bg-[#0067b1] text-white";
  if (b.includes("TIFON")) return "bg-[#1f4bff] text-white";
  if (b.includes("ENI") || b.includes("AGIP"))
    return "bg-[#ffd100] text-[#111]";
  if (b.includes("Q8")) return "bg-[#005baa] text-white";
  if (b.includes("TOTAL")) return "bg-[#ed1b2f] text-white";
  if (b.includes("TESLA")) return "bg-white text-[#111]";
  if (b.includes("UNKNOWN")) return "bg-[#b9fb6a] text-[#071a12]";
  return "bg-white/90 text-[#0b1f16]";
}

function inferBrandKey(item: Pick<Result, "brand" | "name">) {
  const source = `${normalize(item.brand)} ${normalize(item.name)}`;
  const known = [
    "PETROL",
    "MOL",
    "SHELL",
    "OMV",
    "BP",
    "HOFER",
    "DISKONT",
    "GENOL",
    "LAGERHAUS",
    "TURMÖL",
    "TURMOEL",
    "JET",
    "AVIA",
    "MAXEN",
    "INA",
    "TIFON",
    "CRODUX",
    "ENI",
    "Q8",
    "IP",
    "TAMOIL",
    "ESSO",
    "TOTALENERGIES",
    "TESLA",
    "LIDL",
  ];
  const match = known.find((value) => source.includes(value));
  if (!match) return normalize(item.brand) || "";
  if (match === "TURMOEL") return "TURMÖL";
  return match;
}

function premiumBrandRank(item: Pick<Result, "brand" | "name">) {
  const key = inferBrandKey(item);
  const rank = PREMIUM_BRAND_PRIORITY.indexOf(key);
  return rank >= 0 ? rank : 999;
}

function isPremiumBrand(item: Pick<Result, "brand" | "name">) {
  return premiumBrandRank(item) < 999;
}

function brandLabel(value: string) {
  const labels: Record<string, string> = {
    PETROL: "Petrol",
    MOL: "MOL",
    SHELL: "Shell",
    OMV: "OMV",
    BP: "BP",
    HOFER: "Hofer/Diskont",
    DISKONT: "Hofer/Diskont",
    GENOL: "Genol",
    LAGERHAUS: "Lagerhaus",
    TURMÖL: "Turmöl",
    TURMOEL: "Turmöl",
    JET: "JET",
    AVIA: "Avia",
    MAXEN: "Maxen",
    INA: "INA",
    TIFON: "Tifon",
    CRODUX: "Crodux",
    ENI: "Eni",
    Q8: "Q8",
    IP: "IP",
    TAMOIL: "Tamoil",
    ESSO: "Esso",
    TOTALENERGIES: "TotalEnergies",
    TESLA: "Tesla",
    LIDL: "Lidl",
  };
  return labels[normalize(value)] || value;
}

function parseBrandSelection(value?: string | null) {
  const raw = String(value || "ALL").trim();
  if (!raw || normalize(raw) === "ALL") return [];

  return raw
    .split(",")
    .map((item) => normalize(item))
    .filter(Boolean)
    .filter((item) => item !== "ALL");
}

function formatBrandSelection(value?: string | null) {
  const selected = parseBrandSelection(value);
  if (!selected.length) return "Vse znamke";
  if (selected.length === 1) return brandLabel(selected[0]);
  if (selected.length <= 3) return selected.map(brandLabel).join(", ");
  return `${selected.length} znamke`;
}

function brandValueMatches(item: Result, selectedBrand: string) {
  const selected = normalize(selectedBrand);
  if (!selected || selected === "ALL") return true;

  const brand = normalize(item.brand);
  const name = normalize(item.name);
  const address = normalize(item.address);
  const inferred = inferBrandKey(item);
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

function stationBrandMatches(item: Result, selectedBrand: string) {
  const selected = parseBrandSelection(selectedBrand);
  if (!selected.length) return true;
  return selected.some((brand) => brandValueMatches(item, brand));
}

function powerBadge(item: Result) {
  if (!isEv(item)) return null;
  if (item.max_power_kw) return `${Math.round(Number(item.max_power_kw))} kW`;
  return item.power_type || "EV";
}

function scoreItem(
  item: Result,
  includeFuel: boolean,
  includePath: boolean,
  includeTime: boolean,
) {
  if (includeFuel && !hasCost(item.fuel_cost)) return 999999;
  if (includePath && !hasCost(item.travel_fuel_cost)) return 999999;

  const fuel = includeFuel ? Number(item.fuel_cost) : 0;
  const path = includePath ? Number(item.travel_fuel_cost) : 0;
  const time =
    includeTime && hasCost(item.time_cost) ? Number(item.time_cost) : 0;

  return Number((fuel + path + time).toFixed(2));
}

function sortClientResults(
  rows: Result[],
  sortBy: SortBy,
  includeFuel: boolean,
  includePath: boolean,
  includeTime: boolean,
) {
  return [...rows].sort((a, b) => {
    const aScore = scoreItem(a, includeFuel, includePath, includeTime);
    const bScore = scoreItem(b, includeFuel, includePath, includeTime);

    const aPrice = hasUsablePrice(a) ? Number(a.price) : 999;
    const bPrice = hasUsablePrice(b) ? Number(b.price) : 999;

    if (sortBy === "price") {
      if (aPrice !== bPrice) return aPrice - bPrice;
      if (a.distance_km !== b.distance_km) return a.distance_km - b.distance_km;
      return aScore - bScore;
    }

    if (sortBy === "distance") {
      if (a.distance_km !== b.distance_km) return a.distance_km - b.distance_km;
      if (aPrice !== bPrice) return aPrice - bPrice;
      return aScore - bScore;
    }

    if (isEv(a) || isEv(b)) {
      const aTankaj = Number(a.tankaj_score ?? aScore);
      const bTankaj = Number(b.tankaj_score ?? bScore);

      if (aTankaj !== bTankaj) return aTankaj - bTankaj;

      const aPower = Number(a.max_power_kw || 0);
      const bPower = Number(b.max_power_kw || 0);

      if (aPower !== bPower) return bPower - aPower;
    }

    if (aScore !== bScore) return aScore - bScore;
    return a.distance_km - b.distance_km;
  });
}

function reasonBySort(sortBy: SortBy, mode: SearchMode) {
  if (mode === "ev") {
    if (sortBy === "price")
      return "Najcenejša cena na kWh med prikazanimi polnilnicami.";
    if (sortBy === "distance")
      return "Najbližja EV polnilnica po realni cestni poti.";
    return "Najboljša kombinacija cene polnjenja, poti, časa in moči polnilnice.";
  }

  if (sortBy === "price") return "Najcenejša cena na liter v izbranem radiusu.";
  if (sortBy === "distance") return "Najbližja črpalka po realni cestni poti.";
  return "Najboljša kombinacija izbranih stroškov.";
}

function buildCrossBorderInsight(
  results: Result[],
  best: Result | null,
  includeFuel: boolean,
  includePath: boolean,
  includeTime: boolean,
) {
  if (!best || !best.country_code || isEv(best)) return null;

  const homeCountry =
    results.find((r) => !r.is_cross_border)?.country_code || "SI";
  const homeOptions = results.filter((r) => r.country_code === homeCountry);
  const crossBorderOptions = results.filter(
    (r) => r.country_code && r.country_code !== homeCountry,
  );

  if (!homeOptions.length || !crossBorderOptions.length) return null;

  const bestHome = [...homeOptions].sort(
    (a, b) =>
      scoreItem(a, includeFuel, includePath, includeTime) -
      scoreItem(b, includeFuel, includePath, includeTime),
  )[0];
  const bestCross = [...crossBorderOptions].sort(
    (a, b) =>
      scoreItem(a, includeFuel, includePath, includeTime) -
      scoreItem(b, includeFuel, includePath, includeTime),
  )[0];
  if (!bestHome || !bestCross) return null;

  const saving = Number(
    (
      scoreItem(bestHome, includeFuel, includePath, includeTime) -
      scoreItem(bestCross, includeFuel, includePath, includeTime)
    ).toFixed(2),
  );

  return {
    saving,
    homeCountry,
    crossCountry: bestCross.country_code,
    station: bestCross,
    isWorthIt: saving > 1,
  };
}

export default function Home() {
  const [mode, setMode] = useState<SearchMode>("fuel");
  const [fuelType, setFuelType] = useState("PETROL_95");
  const [radius, setRadius] = useState(25);
  const [amount, setAmount] = useState(50);
  const [brand, setBrand] = useState("ALL");
  const [country, setCountry] = useState("ALL");
  const [sortBy, setSortBy] = useState<SortBy>("smart");
  const [evChargingMode, setEvChargingMode] = useState<EvChargingMode>("DC");
  const [evAmountKwh, setEvAmountKwh] = useState(30);
  const [evMinPowerKw, setEvMinPowerKw] = useState(0);
  const [evConsumptionKwh100, setEvConsumptionKwh100] = useState(21);
  const [useEvSubscriptionPrices, setUseEvSubscriptionPrices] = useState(false);
  useEffect(() => {
    if (mode !== "ev") return;

    setEvMinPowerKw((prev) => {
      if (evChargingMode === "AC") return 0;
      if (evChargingMode === "DC" && prev < 50) return 50;
      return prev;
    });
  }, [mode, evChargingMode]);
  const [showOthers, setShowOthers] = useState(false);
  const [includeFuel, setIncludeFuel] = useState(true);
  const [includePath, setIncludePath] = useState(true);
  const [includeTime, setIncludeTime] = useState(true);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [results, setResults] = useState<Result[]>([]);
  const resultsRef = useRef<Result[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [searched, setSearched] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [nextOffset, setNextOffset] = useState(6);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pricingMode, setPricingMode] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [showManualLocation, setShowManualLocation] = useState(false);
  const [manualLocationQuery, setManualLocationQuery] = useState("");
  const [manualLocationResults, setManualLocationResults] = useState<
    GeocodeResult[]
  >([]);
  const [manualLocationLoading, setManualLocationLoading] = useState(false);
  const [manualLocationError, setManualLocationError] = useState<string | null>(
    null,
  );

  const activeRequestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const didAutoLocate = useRef(false);

  const loading = status === "location" || status === "routing";

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        setPreferencesReady(true);
        return;
      }

      const parsed = JSON.parse(saved) as Preferences;
      if (parsed.mode) setMode(parsed.mode);
      if (parsed.fuelType) setFuelType(parsed.fuelType);
      if (typeof parsed.radius === "number") setRadius(parsed.radius);
      if (typeof parsed.amount === "number") setAmount(parsed.amount);
      if (parsed.brand) setBrand(parsed.brand);
      if (parsed.country) setCountry(parsed.country);
      if (parsed.sortBy) setSortBy(parsed.sortBy);
      if (typeof parsed.includeFuel === "boolean")
        setIncludeFuel(parsed.includeFuel);
      if (typeof parsed.includePath === "boolean")
        setIncludePath(parsed.includePath);
      if (typeof parsed.includeTime === "boolean")
        setIncludeTime(parsed.includeTime);
      if (parsed.evChargingMode) setEvChargingMode(parsed.evChargingMode);
      if (typeof parsed.evAmountKwh === "number")
        setEvAmountKwh(parsed.evAmountKwh);
      if (typeof parsed.evMinPowerKw === "number")
        setEvMinPowerKw(parsed.evMinPowerKw);
      if (typeof parsed.evConsumptionKwh100 === "number")
        setEvConsumptionKwh100(parsed.evConsumptionKwh100);
      if (typeof parsed.useEvSubscriptionPrices === "boolean")
        setUseEvSubscriptionPrices(parsed.useEvSubscriptionPrices);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setPreferencesReady(true);
    }
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;

    const payload: Preferences = {
      mode,
      fuelType,
      radius,
      amount,
      brand,
      country,
      sortBy,
      includeFuel,
      includePath,
      includeTime,
      evChargingMode,
      evAmountKwh,
      evMinPowerKw,
      evConsumptionKwh100,
      useEvSubscriptionPrices,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    preferencesReady,
    mode,
    fuelType,
    radius,
    amount,
    brand,
    country,
    sortBy,
    includeFuel,
    includePath,
    includeTime,
    evChargingMode,
    evAmountKwh,
    evMinPowerKw,
    evConsumptionKwh100,
    useEvSubscriptionPrices,
  ]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const brandOptions = useMemo(() => {
    const available = new Map<string, string>();

    const defaultFuelBrands = [
      "PETROL",
      "MOL",
      "OMV",
      "SHELL",
      "HOFER",
      "BP",
      "ENI",
      "JET",
      "AVIA",
      "TURMÖL",
      "GENOL",
      "INA",
      "TIFON",
      "CRODUX",
      "Q8",
      "IP",
      "TAMOIL",
      "ESSO",
      "TOTALENERGIES",
    ];

    const defaultEvBrands = ["TESLA", "PETROL", "LIDL", "MOL", "IONITY"];

    for (const key of mode === "ev" ? defaultEvBrands : defaultFuelBrands) {
      available.set(key, brandLabel(key));
    }

    for (const item of results) {
      const key = inferBrandKey(item);
      if (!key || key.includes("UNKNOWN")) continue;
      available.set(key, brandLabel(key));
    }

    return [
      ["ALL", mode === "ev" ? "Vsi ponudniki" : "Vse znamke"],
      ...Array.from(available.entries()).sort((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    ];
  }, [results, mode]);

  useEffect(() => {
    const selected = parseBrandSelection(brand);
    if (!selected.length) return;

    const allowed = new Set(brandOptions.map(([value]) => normalize(value)));
    const kept = selected.filter((value) => allowed.has(value));

    if (!kept.length) {
      setBrand("ALL");
      return;
    }

    if (kept.length !== selected.length) {
      setBrand(kept.join(","));
    }
  }, [brand, brandOptions]);

  const filteredResults = useMemo(() => {
    return results.filter((item) => stationBrandMatches(item, brand));
  }, [results, brand]);

  const sortedResults = useMemo(() => {
    return sortClientResults(
      filteredResults,
      sortBy,
      includeFuel,
      includePath,
      includeTime,
    );
  }, [filteredResults, sortBy, includeFuel, includePath, includeTime]);

  const best = sortedResults[0] || null;

  const otherResults = useMemo(() => {
    const unique = new Map<string, Result>();
    for (const item of sortedResults) {
      if (best?.location_id === item.location_id) continue;
      const key = resultMergeKey(item);
      if (!unique.has(key)) unique.set(key, item);
    }

    return Array.from(unique.values());
  }, [sortedResults, best]);

  const nearest = useMemo(() => {
    if (!filteredResults.length) return null;
    return (
      [...filteredResults].sort((a, b) => a.distance_km - b.distance_km)[0] ||
      null
    );
  }, [filteredResults]);

  const savingVsNearest = useMemo(() => {
    if (
      !best ||
      !nearest ||
      best.location_id === nearest.location_id ||
      isEv(best)
    )
      return 0;
    const nearestScore = scoreItem(
      nearest,
      includeFuel,
      includePath,
      includeTime,
    );
    const bestScore = scoreItem(best, includeFuel, includePath, includeTime);
    return Number((nearestScore - bestScore).toFixed(2));
  }, [best, nearest, includeFuel, includePath, includeTime]);

  const crossBorderInsight = useMemo(() => {
    return buildCrossBorderInsight(
      filteredResults,
      best,
      includeFuel,
      includePath,
      includeTime,
    );
  }, [filteredResults, best, includeFuel, includePath, includeTime]);

  const lastUpdated = useMemo(() => {
    if (!best?.captured_at) return null;
    const diffMin = Math.max(
      0,
      Math.round((Date.now() - new Date(best.captured_at).getTime()) / 60000),
    );
    if (diffMin < 1) return "pravkar";
    if (diffMin < 60) return `pred ${diffMin} min`;
    return `pred ${Math.round(diffMin / 60)} h`;
  }, [best]);

  const buildSearchParams = useCallback(
    (
      point: { lat: number; lng: number },
      batch: "initial" | "more",
      offset?: number,
    ) => {
      const params = new URLSearchParams({
        lat: String(point.lat),
        lng: String(point.lng),
        radius: String(radius),
        amount: String(mode === "ev" ? evAmountKwh : amount),
        sortBy,
        batch,
        country,
      });

      if (typeof offset === "number") params.set("offset", String(offset));

      if (mode === "ev") {
        params.set("powerType", evChargingMode);
        params.set("minPowerKw", String(evMinPowerKw));
        params.set("consumption", String(evConsumptionKwh100));
        if (useEvSubscriptionPrices)
          params.set("useEvSubscriptionPrices", "true");
        if (batch === "more") params.set("includeEstimated", "true");
      } else {
        params.set("type", fuelType);
        params.set("mode", "nearby");
        if (parseBrandSelection(brand).length) params.set("brand", brand);
      }

      return params;
    },
    [
      mode,
      radius,
      amount,
      evAmountKwh,
      sortBy,
      country,
      evChargingMode,
      evMinPowerKw,
      evConsumptionKwh100,
      useEvSubscriptionPrices,
      fuelType,
    ],
  );

  const applySearchResponse = useCallback((json: any, append = false) => {
    const incoming = (json.results || []) as Result[];
    const next = Number(json.next_offset);

    setPricingMode(json.pricing_mode || null);
    setDisclaimer(json.disclaimer || null);
    setNextOffset(Number.isFinite(next) ? next : 0);
    setHasMore(Boolean(json.has_more) && incoming.length > 0);

    if (!append) {
      setResults(incoming);
      resultsRef.current = incoming;
      return;
    }

    setResults((prev) => {
      const merged = mergeUniqueResults(prev, incoming);
      resultsRef.current = merged;

      if (merged.length === prev.length && !json.has_more) {
        setHasMore(false);
      }

      return merged;
    });
  }, []);

  const runSearch = useCallback(
    async (point: { lat: number; lng: number }) => {
      const requestId = ++activeRequestId.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSearched(true);
      setShowOthers(false);
      setStatus("routing");
      setPricingMode(null);
      setDisclaimer(null);

      try {
        const params = buildSearchParams(point, "initial");
        const endpoint = mode === "ev" ? "/api/search/ev" : "/api/search";
        const res = await fetch(`${endpoint}?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!res.ok) throw new Error("Search failed");
        const json = await res.json();
        if (requestId !== activeRequestId.current) return;

        applySearchResponse(json);
        setStatus("done");

        trackEvent("search_completed", {
          mode,
          fuel_type: mode === "ev" ? `EV_${evChargingMode}` : fuelType,
          radius,
          amount: mode === "ev" ? evAmountKwh : amount,
          brand,
          results_count: Number(json.results?.length || 0),
          has_more: Boolean(json.has_more),
        });
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        if (requestId !== activeRequestId.current) return;
        trackEvent("search_failed", {
          mode,
          radius,
          fuel_type: mode === "ev" ? `EV_${evChargingMode}` : fuelType,
        });
        setStatus("error");
      }
    },
    [
      buildSearchParams,
      mode,
      evChargingMode,
      fuelType,
      radius,
      evAmountKwh,
      amount,
      brand,
      applySearchResponse,
    ],
  );

  const searchManualLocation = useCallback(async (query: string) => {
    const q = query.trim();
    setManualLocationQuery(query);
    setManualLocationError(null);

    if (q.length < 2) {
      setManualLocationResults([]);
      return;
    }

    setManualLocationLoading(true);

    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Lokacije ni mogoče poiskati.");
      }

      setManualLocationResults((json.results || []) as GeocodeResult[]);
    } catch (error) {
      setManualLocationResults([]);
      setManualLocationError(
        error instanceof Error ? error.message : "Lokacije ni mogoče poiskati.",
      );
    } finally {
      setManualLocationLoading(false);
    }
  }, []);

  const selectManualLocation = useCallback(
    (item: GeocodeResult) => {
      const nextCoords = { lat: Number(item.lat), lng: Number(item.lng) };
      if (!Number.isFinite(nextCoords.lat) || !Number.isFinite(nextCoords.lng))
        return;

      setManualLocationQuery(item.label);
      setManualLocationResults([]);
      setManualLocationError(null);
      setShowManualLocation(false);
      setCoords(nextCoords);
      setSearched(true);
      trackEvent("manual_location_selected", {
        country_code: item.country_code || null,
      });
      runSearch(nextCoords);
    },
    [runSearch],
  );

  const requestLocationAndSearch = useCallback(() => {
    if (coords) {
      setSearched(true);
      runSearch(coords);
      return;
    }

    if (!navigator.geolocation) {
      setShowManualLocation(true);
      setStatus("error");
      return;
    }

    setSearched(true);
    setStatus("location");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        trackEvent("location_allowed");
        const nextCoords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setCoords(nextCoords);
        setShowManualLocation(false);
        setManualLocationResults([]);
        runSearch(nextCoords);
      },
      () => {
        trackEvent("location_denied");
        setShowManualLocation(true);
        setStatus("error");
      },
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 },
    );
  }, [coords, runSearch]);

  useEffect(() => {
    if (!preferencesReady) return;
    if (didAutoLocate.current) return;
    didAutoLocate.current = true;
    requestLocationAndSearch();
  }, [preferencesReady, requestLocationAndSearch]);

  const lastAutoSearchKey = useRef<string | null>(null);

  useEffect(() => {
    if (!preferencesReady) return;
    if (!coords) return;
    if (!searched) return;

    const key = [
      mode,
      evChargingMode,
      radius,
      mode === "ev" ? evAmountKwh : amount,
      mode === "ev" ? evConsumptionKwh100 : fuelType,
      mode === "ev" ? evMinPowerKw : brand,
      mode === "ev" ? String(useEvSubscriptionPrices) : "",
      country,
    ].join(":");
    if (lastAutoSearchKey.current === key) return;

    lastAutoSearchKey.current = key;
    setShowOthers(false);
    runSearch(coords);
  }, [
    preferencesReady,
    coords,
    searched,
    mode,
    evChargingMode,
    radius,
    evAmountKwh,
    evConsumptionKwh100,
    evMinPowerKw,
    useEvSubscriptionPrices,
    amount,
    fuelType,
    brand,
    country,
    runSearch,
  ]);

  async function loadMoreResults() {
    if (!coords || loadingMore || !hasMore) return;
    setLoadingMore(true);

    const endpoint = mode === "ev" ? "/api/search/ev" : "/api/search";
    const startOffset = nextOffset;
    let offset = nextOffset;
    let merged = resultsRef.current;
    let addedCount = 0;
    let receivedCount = 0;
    let latestHasMore: boolean = hasMore;

    try {
      for (
        let attempt = 0;
        attempt < 5 && latestHasMore && addedCount < 5;
        attempt += 1
      ) {
        const params = buildSearchParams(coords, "more", offset);
        const res = await fetch(`${endpoint}?${params.toString()}`);

        if (!res.ok) throw new Error("Failed to load more results");

        const json = await res.json();
        const incoming = (json.results || []) as Result[];
        const beforeCount = merged.length;

        receivedCount += incoming.length;
        merged = mergeUniqueResults(merged, incoming);
        addedCount += Math.max(0, merged.length - beforeCount);

        const next = Number(json.next_offset);
        offset = Number.isFinite(next) ? next : offset + incoming.length;
        latestHasMore = Boolean(json.has_more) && incoming.length > 0;

        setPricingMode(json.pricing_mode || null);
        setDisclaimer(json.disclaimer || null);

        if (!latestHasMore) break;
      }

      resultsRef.current = merged;
      setResults(merged);
      setNextOffset(offset);
      setHasMore(latestHasMore && addedCount > 0);
      setShowOthers(true);

      trackEvent("load_more_results", {
        mode,
        next_offset: startOffset,
        new_next_offset: offset,
        received_count: receivedCount,
        added_count: addedCount,
        sort_by: sortBy,
        radius,
      });
    } catch {
      trackEvent("load_more_failed", { mode, sort_by: sortBy, radius });
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  function mapsUrl(item: Result) {
    return `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}`;
  }

  async function shareResult() {
    if (!best) return;
    trackEvent("share_result", {
      mode,
      station_country: best.country_code || null,
      station_brand: best.brand || null,
    });

    const text = isEv(best)
      ? "Tankaj.si mi je našel najbolj smiselno EV polnilnico glede na ceno, pot, čas in moč polnilnice."
      : savingVsNearest > 0.2
        ? `Tankaj.si mi je našel boljšo izbiro za tankanje. Prihranek: približno ${savingVsNearest.toFixed(2)} €.`
        : "Tankaj.si mi je našel najbolj smiselno črpalko glede na ceno, razdaljo in strošek poti.";

    if (navigator.share) {
      await navigator.share({
        title: "Tankaj.si",
        text,
        url: window.location.origin,
      });
      return;
    }

    await navigator.clipboard.writeText(`${text} ${window.location.origin}`);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1800);
  }

  function handleSortChange(value: SortBy) {
    setSortBy(value);
    setShowOthers(false);
    trackEvent("sort_changed", { mode, sort_by: value });
  }

  return (
    <main
      id="top"
      className="relative min-h-dvh w-full max-w-[100svw] overflow-x-clip bg-[#06140f] pb-[calc(7rem+env(safe-area-inset-bottom))] text-white md:pb-0"
    >
      <style jsx global>{`
        html,
        body {
          max-width: 100%;
          overflow-x: hidden;
          overscroll-behavior-x: none;
        }
        #top,
        #top * {
          box-sizing: border-box;
        }
      `}</style>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(185,251,106,.23),transparent_28%),radial-gradient(circle_at_92%_12%,rgba(44,120,76,.24),transparent_34%),linear-gradient(180deg,#071a12_0%,#04100b_100%)]" />

      <section className="relative mx-auto flex min-h-dvh w-full max-w-[1320px] min-w-0 flex-col px-3 py-3 sm:px-6 lg:px-8 lg:py-7">
        <div className="grid w-full min-w-0 flex-1 gap-4 lg:grid-cols-2 xl:gap-6">
          <HeroSearch
            mode={mode}
            setMode={setMode}
            fuelType={fuelType}
            setFuelType={setFuelType}
            radius={radius}
            setRadius={setRadius}
            amount={amount}
            setAmount={setAmount}
            brand={brand}
            setBrand={setBrand}
            brandOptions={brandOptions}
            country={country}
            setCountry={setCountry}
            evChargingMode={evChargingMode}
            setEvChargingMode={setEvChargingMode}
            evAmountKwh={evAmountKwh}
            setEvAmountKwh={setEvAmountKwh}
            evMinPowerKw={evMinPowerKw}
            setEvMinPowerKw={setEvMinPowerKw}
            evConsumptionKwh100={evConsumptionKwh100}
            setEvConsumptionKwh100={setEvConsumptionKwh100}
            useEvSubscriptionPrices={useEvSubscriptionPrices}
            setUseEvSubscriptionPrices={setUseEvSubscriptionPrices}
            loading={loading}
            status={status}
            search={requestLocationAndSearch}
            showManualLocation={showManualLocation}
            setShowManualLocation={setShowManualLocation}
            manualLocationQuery={manualLocationQuery}
            manualLocationResults={manualLocationResults}
            manualLocationLoading={manualLocationLoading}
            manualLocationError={manualLocationError}
            searchManualLocation={searchManualLocation}
            selectManualLocation={selectManualLocation}
            includeFuel={includeFuel}
            setIncludeFuel={setIncludeFuel}
            includePath={includePath}
            setIncludePath={setIncludePath}
            includeTime={includeTime}
            setIncludeTime={setIncludeTime}
          />

          <ResultPanel
            mode={mode}
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
            pricingMode={pricingMode}
            disclaimer={disclaimer}
          />
        </div>

        <HowItWorks />
      </section>
    </main>
  );
}

function HeroSearch({
  mode,
  setMode,
  fuelType,
  setFuelType,
  radius,
  setRadius,
  amount,
  setAmount,
  brand,
  setBrand,
  brandOptions,
  country,
  setCountry,
  evChargingMode,
  setEvChargingMode,
  evAmountKwh,
  setEvAmountKwh,
  evMinPowerKw,
  setEvMinPowerKw,
  evConsumptionKwh100,
  setEvConsumptionKwh100,
  useEvSubscriptionPrices,
  setUseEvSubscriptionPrices,
  loading,
  status,
  search,
  showManualLocation,
  setShowManualLocation,
  manualLocationQuery,
  manualLocationResults,
  manualLocationLoading,
  manualLocationError,
  searchManualLocation,
  selectManualLocation,
  includeFuel,
  setIncludeFuel,
  includePath,
  setIncludePath,
  includeTime,
  setIncludeTime,
}: any) {
  const [showEvAdvanced, setShowEvAdvanced] = useState(false);

  return (
    <div className="w-full min-w-0 max-w-full overflow-visible rounded-[30px] border border-white/10 bg-white/[0.055] p-4 shadow-[0_25px_80px_rgba(0,0,0,.25)] backdrop-blur-2xl sm:p-6 lg:min-h-[720px] lg:p-8">
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

      <h1 className="mt-6 max-w-xl text-[42px] font-black leading-[.94] tracking-[-.055em] min-[380px]:text-[50px] sm:text-[64px] lg:text-[72px] xl:text-[78px]">
        Ne tankaj več na pamet.
      </h1>

      <p className="mt-5 max-w-lg text-base leading-relaxed text-white/60 sm:text-lg">
        Odpri app, dovoli lokacijo in Tankaj.si sam izračuna najboljšo izbiro.
        Zdaj podpira goriva in EV polnilnice — z realno potjo, časom in oceno
        skupnega stroška.
      </p>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowManualLocation((v: boolean) => !v)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-sm font-black text-white/70 transition hover:border-[#b9fb6a]/30 hover:text-white"
        >
          <span>⌖</span>
          <span>
            {showManualLocation ? "Skrij ročni vnos" : "Vnesi lokacijo ročno"}
          </span>
        </button>

        {showManualLocation && (
          <div className="mt-3 rounded-[22px] border border-white/10 bg-[#071a12]/62 p-3">
            <label className="block text-xs font-black text-white/45">
              Lokacija za iskanje
            </label>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={manualLocationQuery}
                onChange={(e) => searchManualLocation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualLocationResults[0]) {
                    selectManualLocation(manualLocationResults[0]);
                  }
                }}
                placeholder="Npr. Ljubljana, Koper, Zagreb ..."
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-white/30 focus:border-[#b9fb6a]/45"
              />
              <button
                type="button"
                onClick={() => {
                  if (manualLocationResults[0]) {
                    selectManualLocation(manualLocationResults[0]);
                  } else {
                    searchManualLocation(manualLocationQuery);
                  }
                }}
                className="rounded-2xl bg-[#b9fb6a] px-4 py-3 text-sm font-black text-[#071a12]"
              >
                Uporabi
              </button>
            </div>

            {manualLocationLoading && (
              <div className="mt-2 text-xs font-semibold text-white/45">
                Iščem lokacijo ...
              </div>
            )}

            {manualLocationError && (
              <div className="mt-2 text-xs font-semibold text-red-200/80">
                {manualLocationError}
              </div>
            )}

            {manualLocationResults.length > 0 && (
              <div className="mt-3 max-h-56 overflow-auto rounded-2xl border border-white/10 bg-black/30">
                {manualLocationResults.map(
                  (item: GeocodeResult, index: number) => (
                    <button
                      key={`${item.lat}-${item.lng}-${index}`}
                      type="button"
                      onClick={() => selectManualLocation(item)}
                      className="block w-full border-b border-white/5 px-4 py-3 text-left text-sm font-semibold leading-relaxed text-white/72 transition last:border-b-0 hover:bg-white/[0.06] hover:text-white"
                    >
                      {item.label}
                    </button>
                  ),
                )}
              </div>
            )}

            <div className="mt-2 text-[11px] leading-relaxed text-white/35">
              Uporabno, če imaš sledenje lokacije izklopljeno. Iskanje bo
              uporabljalo izbrano lokacijo namesto GPS-a.
            </div>
          </div>
        )}
      </div>

      <ModeSwitch mode={mode} setMode={setMode} />

      <div className="mt-4 w-full min-w-0 max-w-full overflow-visible rounded-[26px] border border-white/10 bg-[#123024]/72 p-3 sm:p-4 lg:p-5">
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 items-end">
          {mode === "fuel" ? (
            <>
              <SelectDark
                label="Gorivo"
                value={fuelType}
                onChange={setFuelType}
                options={[
                  ["PETROL_95", "Bencin 95"],
                  ["DIESEL", "Dizel"],
                ]}
              />
              <SelectDark
                label="Radius"
                value={String(radius)}
                onChange={(v) => setRadius(Number(v))}
                options={[
                  ["5", "5 km"],
                  ["10", "10 km"],
                  ["25", "25 km"],
                  ["50", "50 km"],
                  ["100", "100 km"],
                  ["200", "200 km"],
                ]}
              />
              <NumberDark
                label="Količina"
                suffix="L"
                value={amount}
                onChange={setAmount}
              />
              <BrandMultiSelect
                label="Znamke"
                value={brand}
                onChange={setBrand}
                options={brandOptions}
              />
            </>
          ) : (
            <>
              <EvChargeSwitch
                value={evChargingMode}
                onChange={setEvChargingMode}
              />

              <SelectDark
                label="Radius"
                value={String(radius)}
                onChange={(v) => setRadius(Number(v))}
                options={[
                  ["5", "5 km"],
                  ["10", "10 km"],
                  ["25", "25 km"],
                  ["50", "50 km"],
                  ["100", "100 km"],
                  ["200", "200 km"],
                ]}
              />

              <button
                type="button"
                onClick={() => setShowEvAdvanced((v) => !v)}
                className="sm:col-span-2 flex h-[52px] items-center justify-between rounded-2xl border border-white/10 bg-[#071a12]/55 px-4 text-left text-sm font-black text-white/80 transition hover:border-[#b9fb6a]/35"
              >
                <span>Napredne nastavitve</span>
                <span className="text-lg text-[#b9fb6a]">
                  {showEvAdvanced ? "−" : "+"}
                </span>
              </button>

              {showEvAdvanced && (
                <div className="sm:col-span-2 grid grid-cols-1 gap-4 rounded-2xl border border-white/10 bg-black/15 p-3 sm:grid-cols-2">
                  <NumberDark
                    label="Količina polnjenja"
                    suffix="kWh"
                    value={evAmountKwh}
                    onChange={setEvAmountKwh}
                  />

                  <NumberDark
                    label="Poraba vozila"
                    suffix="kWh/100 km"
                    value={evConsumptionKwh100}
                    onChange={setEvConsumptionKwh100}
                  />

                  <SelectDark
                    label={evChargingMode === "AC" ? "AC moč" : "Min. moč"}
                    value={String(evMinPowerKw)}
                    onChange={(v) => setEvMinPowerKw(Number(v))}
                    options={
                      evChargingMode === "AC"
                        ? [
                            ["0", "Vse AC"],
                            ["11", "Do 11 kW"],
                            ["22", "22 kW+"],
                          ]
                        : [
                            ["0", "Vse moči"],
                            ["30", "30 kW+"],
                            ["50", "50 kW+"],
                            ["100", "100 kW+"],
                            ["150", "150 kW+"],
                          ]
                    }
                  />

                  {mode === "fuel" && (
                    <SelectDark
                      label="Država"
                      value={country}
                      onChange={setCountry}
                      options={COUNTRY_OPTIONS}
                    />
                  )}
                </div>
              )}

              <EvSubscriptionToggle
                checked={useEvSubscriptionPrices}
                onChange={setUseEvSubscriptionPrices}
              />
            </>
          )}

          <button
            onClick={search}
            disabled={loading}
            className="h-[56px] sm:h-[64px] rounded-2xl bg-[#b9fb6a] px-5 text-sm font-black text-[#071a12] shadow-[0_12px_30px_rgba(185,251,106,.22)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 sm:col-span-2"
          >
            {status === "location"
              ? "Pridobivam lokacijo ..."
              : status === "routing"
                ? mode === "ev"
                  ? "Računam EV polnilnice ..."
                  : "Računam realne poti ..."
                : mode === "ev"
                  ? "Poišči najboljšo EV polnilnico"
                  : "Osveži najboljšo izbiro"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid min-w-0 grid-cols-3 gap-2 [&>*]:min-w-0">
        <ToggleInfo
          title={mode === "ev" ? "Energija" : "Gorivo"}
          text={mode === "ev" ? "Cena × kWh" : "Cena × količina"}
          active={includeFuel}
          onClick={() => setIncludeFuel((v: boolean) => !v)}
        />
        <ToggleInfo
          title="Pot"
          text="Realna vožnja"
          active={includePath}
          onClick={() => setIncludePath((v: boolean) => !v)}
        />
        <ToggleInfo
          title="Čas"
          text="Privzeto 12 €/h"
          active={includeTime}
          onClick={() => setIncludeTime((v: boolean) => !v)}
        />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-white/35">
        Nastavitve si zapomnimo na tej napravi. EV cene so označene kot
        preverjene ali ocenjene glede na vir podatkov. Cene s paketom so
        označene z zvezdico in se uporabijo samo, če paket obkljukaš.
      </p>
    </div>
  );
}

function ResultPanel({
  mode,
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
  pricingMode,
  disclaimer,
}: any) {
  const sortOptions = mode === "ev" ? SORT_OPTIONS_EV : SORT_OPTIONS_FUEL;

  return (
    <div
      id="result"
      className="w-full min-w-0 max-w-full overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(185,251,106,.18),transparent_32%),linear-gradient(180deg,rgba(15,48,34,.86),rgba(5,20,14,.88))] p-4 shadow-[0_25px_80px_rgba(0,0,0,.25)] backdrop-blur-2xl sm:p-6 lg:min-h-[720px] lg:p-8"
    >
      {loading && <LoadingState status={status} />}

      {searched && !loading && status === "done" && !best && (
        <EmptyState
          text={
            hasAnyResults
              ? "Za izbrani filter trenutno ni izračunane možnosti. Prikaži vse ponudnike ali naloži dodatne možnosti."
              : mode === "ev"
                ? "V izbranem radiju trenutno ni primernih EV polnilnic. Povečaj radij ali znižaj minimalno moč."
                : "V izbranem radiju trenutno ni izračunanih možnosti. Povečaj radij ali poskusi znova."
          }
        />
      )}

      {searched && !loading && status === "error" && (
        <EmptyState text="Pri iskanju je prišlo do napake. Poskusi znova." />
      )}
      {!searched && !loading && <ExampleState />}

      {!loading && best && (
        <>
          <div className="mb-4 rounded-[24px] border border-white/10 bg-black/15 p-1">
            <div className="grid min-w-0 grid-cols-3 gap-1">
              {sortOptions.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSortBy(value)}
                  className={`min-w-0 truncate rounded-[19px] px-1.5 py-3 text-[11px] font-black transition sm:px-2 sm:text-sm ${sortBy === value ? "bg-[#b9fb6a] text-[#071a12] shadow-[0_10px_24px_rgba(185,251,106,.18)]" : "text-white/55 hover:bg-white/[0.06] hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "ev" && disclaimer && (
            <EvNotice pricingMode={pricingMode} text={disclaimer} />
          )}

          <BestCard
            item={{
              ...best,
              recommendation_reason: reasonBySort(sortBy, mode),
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
              <div className="mt-5 flex w-full min-w-0 items-center justify-between gap-3 overflow-hidden">
                <h2 className="min-w-0 truncate text-[24px] font-black leading-tight tracking-[-0.04em] text-white sm:text-2xl">
                  {mode === "ev"
                    ? "Več EV polnilnic"
                    : "Druge odlične možnosti"}
                </h2>
                {lastUpdated && (
                  <div className="shrink-0 whitespace-nowrap text-xs text-white/40">
                    Cene {lastUpdated}
                  </div>
                )}
              </div>

              {showOthers && otherResults.length > 0 && (
                <div className="mt-3 flex w-full min-w-0 flex-col gap-3 overflow-hidden">
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
                    setShowOthers(true);
                    trackEvent("other_options_opened");
                    return;
                  }
                  if (hasMore) loadMoreResults();
                }}
                disabled={loadingMore || (!hasMore && showOthers)}
                className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-sm font-black text-white transition hover:bg-white/[0.1] disabled:opacity-60"
              >
                {loadingMore
                  ? "Računam dodatne možnosti ..."
                  : !showOthers
                    ? mode === "ev"
                      ? "Prikaži več EV polnilnic"
                      : "Prikaži druge odlične možnosti"
                    : hasMore
                      ? mode === "ev"
                        ? "Naloži več EV polnilnic"
                        : "Naloži še 5 možnosti"
                      : mode === "ev"
                        ? "Prikazane so vse izračunane EV polnilnice"
                        : "Prikazane so vse izračunane možnosti"}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function EvNotice({
  pricingMode,
  text,
}: {
  pricingMode?: string | null;
  text: string;
}) {
  return (
    <div className="mb-4 rounded-[22px] border border-[#b9fb6a]/20 bg-[#b9fb6a]/10 p-4 text-sm leading-relaxed text-[#d9ff9b]">
      <div className="font-black text-[#b9fb6a]">
        {pricingMode === "verified_first"
          ? "EV cene: preverjene tarife najprej"
          : "EV cene: referenčna ocena"}
      </div>
      <div className="mt-1 text-white/62">{text}</div>
    </div>
  );
}

function EvTariffChips({ item }: { item: Result }) {
  const activeTariff = item.applied_tariff_name
    ? {
        name: item.applied_tariff_name,
        price: Number(item.applied_tariff_price ?? item.price ?? 0),
        active: true,
      }
    : null;

  const passive = (item.subscription_tariffs || [])
    .filter((tariff) => tariff.id !== item.applied_tariff_id)
    .slice(0, 2)
    .map((tariff) => ({
      name: tariff.name,
      price: tariff.price,
      active: false,
    }));

  const chips = activeTariff ? [activeTariff, ...passive] : passive;
  if (!chips.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={`${chip.name}-${chip.price}`}
          className={`rounded-full px-2 py-1 text-[10px] font-black ${
            chip.active
              ? "bg-[#b9fb6a] text-[#071a12]"
              : "bg-[#b9fb6a]/12 text-[#b9fb6a]"
          }`}
          title="Cena velja samo za uporabnike izbranega paketa."
        >
          {chip.price.toFixed(2)} €/kWh* · {chip.name}
        </span>
      ))}
    </div>
  );
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
  const displayTotal = scoreItem(item, includeFuel, includePath, includeTime);
  const ev = isEv(item);
  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-[28px] border border-[#b9fb6a]/35 bg-[#071a12]/65 p-4 shadow-[0_18px_60px_rgba(0,0,0,.24)] sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 overflow-hidden">
          <div className="text-[10px] font-black uppercase tracking-[.22em] text-[#b9fb6a] sm:text-xs sm:tracking-[.26em]">
            {ev ? "Najboljša EV izbira" : "Najboljša izbira"}
          </div>
          <h2 className="mt-2 break-words text-xl font-black leading-tight tracking-tight sm:text-3xl">
            {item.name}
          </h2>
          <div className="mt-2 text-sm text-white/50">
            {item.address}
            {item.city ? `, ${item.city}` : ""}
          </div>
          {item.recommendation_reason && (
            <div className="mt-3 inline-flex max-w-full rounded-2xl border border-[#b9fb6a]/20 bg-[#b9fb6a]/12 px-3 py-2 text-xs font-semibold leading-relaxed text-[#b9fb6a] sm:px-4 sm:text-sm">
              {item.recommendation_reason}
            </div>
          )}
        </div>
        <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/75">
          {countryLabel(item.country_code)}
        </div>
      </div>

      <div className="mt-5 w-full min-w-0 max-w-full overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.075] p-3">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_76px] items-start gap-3 sm:grid-cols-[minmax(0,1fr)_92px]">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xs font-black sm:h-12 sm:w-12 ${brandColor(item.brand)}`}
            >
              {brandShort(item.brand)}
            </div>
            <div className="min-w-0 overflow-hidden">
              <div className="text-xs text-white/45">
                {ev ? "Cena polnjenja" : "Cena goriva"}
              </div>
              <div className="truncate text-2xl font-black text-[#b9fb6a] sm:text-3xl">
                {formatUnitPrice(item)}
              </div>
              {!hasUsablePrice(item) && item.price_warning && (
                <div className="mt-2 max-w-[260px] text-[11px] font-semibold leading-snug text-white/45">
                  {item.price_warning}
                </div>
              )}
              {ev && (
                <>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black text-white/70">
                      ⚡ {powerBadge(item)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-black ${
                        item.is_verified
                          ? "bg-[#b9fb6a] text-[#071a12]"
                          : "bg-white/10 text-white/70"
                      }`}
                    >
                      {item.is_verified
                        ? "Dejanska tarifa"
                        : "Referenčna ocena"}
                    </span>
                  </div>

                  {item.price_source_name && (
                    <div className="mt-2 text-[11px] text-white/45">
                      Vir: {item.price_source_name}
                    </div>
                  )}

                  <EvTariffChips item={item} />
                </>
              )}
            </div>
          </div>
          <div className="min-w-0 text-right">
            <div className="text-xs text-white/45">Vožnja</div>
            <div className="font-black">{formatKm(item.distance_km)}</div>
            <div className="text-xs text-white/45">
              ~{item.estimated_drive_minutes} min
            </div>
          </div>
        </div>

        <div className="mt-4 grid min-w-0 grid-cols-3 gap-2 [&>*]:min-w-0">
          <CostPill
            label={ev ? "Energija" : "Gorivo"}
            value={includeFuel ? formatCost(item.fuel_cost) : "—"}
            active={includeFuel}
          />
          <CostPill
            label="Pot"
            value={includePath ? formatCost(item.travel_fuel_cost) : "—"}
            active={includePath}
          />
          <CostPill
            label="Čas"
            value={includeTime ? formatCost(item.time_cost) : "—"}
            active={includeTime}
          />
        </div>

        <div className="mt-3 rounded-2xl border border-[#b9fb6a]/70 bg-[#b9fb6a]/12 p-4 text-white shadow-[0_0_0_1px_rgba(185,251,106,.08),0_18px_46px_rgba(185,251,106,.10)]">
          <div className="text-xs font-black uppercase tracking-[.2em] text-[#b9fb6a]/85">
            Ocenjen skupni strošek
          </div>
          <div className="mt-1 text-3xl font-black text-[#b9fb6a]">
            {displayTotal < 999999 ? formatMoney(displayTotal) : "—"}
          </div>
        </div>
      </div>

      {!ev && savingVsNearest > 0.2 && (
        <div className="mt-3 rounded-2xl bg-[#b9fb6a]/14 px-4 py-3 text-sm text-[#b9fb6a]">
          <span className="font-black">Prihranek:</span> približno{" "}
          {savingVsNearest.toFixed(2)} € proti najbližji možnosti.
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href={mapsUrl(item)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            trackEvent("navigation_clicked", {
              source: "winner_card",
              station_country: item.country_code || null,
              station_brand: item.brand || null,
            })
          }
          className="rounded-2xl bg-white px-4 py-3 text-center text-sm font-black text-[#071a12]"
        >
          Navigacija
        </a>
        <button
          onClick={shareResult}
          className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-white transition hover:bg-white/[0.08]"
        >
          {shareCopied ? "Kopirano ✓" : "Deli"}
        </button>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-white/35">
        {ev
          ? item.is_verified
            ? "Cena polnjenja temelji na znani tarifi, vseeno pred polnjenjem preveri točen cenik pri ponudniku."
            : item.tariff_note ||
              "EV cena je referenčna ocena za državo in tip polnjenja. Dejanska tarifa se lahko razlikuje glede na ponudnika, aplikacijo ali roaming kartico."
          : "Izračun je ocena poti do črpalke. Google Maps lahko pokaže drugačen čas zaradi prometa ali prehoda meje."}
      </p>
    </div>
  );
}

function CompactResult({
  item,
  mapsUrl,
  includeFuel,
  includePath,
  includeTime,
}: {
  item: Result;
  mapsUrl: (item: Result) => string;
  includeFuel: boolean;
  includePath: boolean;
  includeTime: boolean;
}) {
  const displayTotal = scoreItem(item, includeFuel, includePath, includeTime);
  const ev = isEv(item);
  return (
    <a
      href={mapsUrl(item)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() =>
        trackEvent("navigation_clicked", {
          source: "compact_result",
          station_country: item.country_code || null,
          station_brand: item.brand || null,
        })
      }
      className="block w-full max-w-full overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.06] px-3 py-4 transition hover:bg-white/[0.09] sm:p-4"
    >
      <div className="grid w-full min-w-0 grid-cols-[54px_minmax(0,1fr)_76px] items-center gap-3 sm:grid-cols-[62px_minmax(0,1fr)_92px]">
        <div className="contents">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xs font-black sm:h-14 sm:w-14 ${brandColor(item.brand)}`}
          >
            {brandShort(item.brand)}
          </div>
          <div className="min-w-0 overflow-hidden">
            <div className="truncate text-[15px] font-black leading-tight tracking-[-0.02em] text-white sm:text-base">
              {item.name}
            </div>
            <div className="mt-1 truncate text-[12px] font-semibold text-white/38">
              {countryLabel(item.country_code)} · {item.address}
            </div>
            <div className="mt-2 text-[22px] font-black leading-none tracking-[-0.04em] text-[#b9fb6a] sm:text-2xl">
              {formatUnitPrice(item)}
            </div>
            {!hasUsablePrice(item) && item.price_warning && (
              <div className="mt-1 line-clamp-2 text-[11px] font-semibold leading-snug text-white/38">
                {item.price_warning}
              </div>
            )}
            {ev && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black text-white/55">
                  ⚡ {powerBadge(item)}
                </span>
                <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black text-white/55">
                  {item.is_verified ? "Preverjena" : "Ocena"}
                </span>
              </div>
            )}
            {ev && <EvTariffChips item={item} />}
          </div>
        </div>
        <div className="w-[76px] shrink-0 text-right sm:w-[92px]">
          <div className="text-[13px] font-black text-white/80 sm:text-sm">
            {formatKm(item.distance_km)}
          </div>
          <div className="text-[11px] text-white/40">
            ~{item.estimated_drive_minutes} min
          </div>
          <div className="mt-1 text-[10px] text-white/40">skupaj</div>
          <div className="text-[16px] font-black leading-tight text-[#b9fb6a] sm:text-lg">
            {displayTotal < 999999 ? formatMoney(displayTotal) : "—"}
          </div>
        </div>
      </div>
    </a>
  );
}

function ExampleState() {
  return (
    <div className="flex h-full min-h-[520px] flex-col justify-center">
      <div className="text-xs font-black uppercase tracking-[.28em] text-[#b9fb6a]">
        Samodejni izračun
      </div>
      <h2 className="mt-3 max-w-xl text-4xl font-black leading-tight tracking-tight">
        Dovoli lokacijo in rezultat se izračuna sam.
      </h2>
      <div className="mt-7 space-y-3">
        <div className="rounded-3xl bg-white/[0.07] p-4">
          <div className="text-sm text-white/45">1. Lokacija</div>
          <div className="mt-1 text-2xl font-black text-[#b9fb6a]">
            najbližje realne poti
          </div>
        </div>
        <div className="rounded-3xl bg-white/[0.07] p-4">
          <div className="text-sm text-white/45">2. Parametri</div>
          <div className="mt-1 text-2xl font-black text-[#b9fb6a]">
            gorivo ali EV, radij, količina
          </div>
        </div>
        <div className="rounded-3xl bg-[#b9fb6a] p-4 text-[#071a12]">
          <div className="text-sm opacity-70">3. Rezultat</div>
          <div className="mt-1 text-2xl font-black">
            ena najboljša izbira + alternative
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingState({ status }: { status: SearchStatus }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.06] p-5">
      <div className="text-sm font-semibold text-white/55">
        {status === "location"
          ? "Pridobivam tvojo lokacijo ..."
          : "Računam realne poti in strošek ..."}
      </div>
      <div className="mt-5 h-10 w-64 animate-pulse rounded-full bg-white/10" />
      <div className="mt-6 space-y-3">
        <div className="h-40 animate-pulse rounded-3xl bg-white/10" />
        <div className="h-20 animate-pulse rounded-3xl bg-white/10" />
        <div className="h-20 animate-pulse rounded-3xl bg-white/10" />
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.06] p-6 text-white/65">
      {text}
    </div>
  );
}

function CostPill({
  label,
  value,
  active = true,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div
      className={`min-w-0 overflow-hidden rounded-2xl p-2.5 sm:p-3 ${active ? "bg-white/10" : "bg-white/[0.035] opacity-45"}`}
    >
      <div className="truncate text-[9px] font-black uppercase tracking-[.14em] text-white/38 sm:text-[10px] sm:tracking-[.18em]">
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-black sm:text-sm">{value}</div>
    </div>
  );
}

function ToggleInfo({
  title,
  text,
  active,
  onClick,
}: {
  title: string;
  text: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-0 overflow-hidden rounded-2xl border p-2.5 text-left transition sm:p-3 ${active ? "border-[#b9fb6a]/35 bg-[#b9fb6a]/12" : "border-white/10 bg-white/[0.04] opacity-55"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-black text-white sm:text-sm">
          {title}
        </div>
        <div
          className={`h-4 w-4 rounded-full border ${active ? "border-[#b9fb6a] bg-[#b9fb6a]" : "border-white/25"}`}
        />
      </div>
      <div className="mt-1 truncate text-[10px] text-white/45 sm:text-xs">
        {text}
      </div>
    </button>
  );
}

function MiniInfo({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
      <div className="min-w-0 truncate text-xs font-black text-white sm:text-sm">
        {title}
      </div>
      <div className="mt-1 truncate text-[10px] text-white/45 sm:text-xs">
        {text}
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="mt-5 w-full min-w-0 overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.055] p-5 backdrop-blur-2xl sm:p-7"
    >
      <h2 className="text-3xl font-black tracking-tight">Kako deluje?</h2>
      <p className="mt-4 max-w-4xl text-sm leading-relaxed text-white/60 sm:text-base">
        Tankaj.si samodejno izračuna realne poti do črpalk in EV polnilnic v
        izbranem radiju. Pri gorivu primerja ceno na liter, pri EV pa ceno na
        kWh, moč polnilnice, pot in čas. Uporabnik lahko sam določi, ali se pri
        skupnem strošku upoštevajo energija, pot in čas.
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <MiniInfo title="Formula" text="energija + pot + čas" />
        <MiniInfo title="Radius" text="Vedno upoštevamo tvoj izbor" />
        <MiniInfo title="Samodejno" text="Zadnje nastavitve si zapomnimo" />
      </div>
      <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.05] p-4 text-sm leading-relaxed text-white/55">
        <div className="font-black text-white">Opombe o EV cenah</div>
        <p className="mt-2">
          Pri EV polnilnicah najprej uporabljamo preverjene tarife, kjer so
          javno dostopne. Kjer točne tarife niso javno objavljene, uporabimo
          referenčno oceno po državi in tipu polnjenja (AC/DC).
        </p>
        <p className="mt-2">
          Referenčni viri vključujejo javne cenike večjih ponudnikov, kot so
          Petrol, Gremo na elektriko, MOL Plugee, Smatrics, Enel X Way, IONITY
          in drugi. Dejanska cena se lahko razlikuje glede na aplikacijo,
          naročnino ali roaming kartico.
        </p>
      </div>
    </section>
  );
}

function ModeSwitch({
  mode,
  setMode,
}: {
  mode: SearchMode;
  setMode: (value: SearchMode) => void;
}) {
  return (
    <div className="mt-6 grid w-full grid-cols-2 rounded-[22px] border border-white/10 bg-black/15 p-1">
      <button
        type="button"
        onClick={() => setMode("fuel")}
        className={`rounded-[18px] px-4 py-3 text-sm font-black transition ${mode === "fuel" ? "bg-[#b9fb6a] text-[#071a12] shadow-[0_10px_24px_rgba(185,251,106,.18)]" : "text-white/55 hover:text-white"}`}
      >
        ⛽ Goriva
      </button>
      <button
        type="button"
        onClick={() => setMode("ev")}
        className={`rounded-[18px] px-4 py-3 text-sm font-black transition ${
          mode === "ev"
            ? "bg-[#b9fb6a] text-[#071a12] shadow-[0_10px_24px_rgba(185,251,106,.18)]"
            : "text-white/55 hover:text-white"
        }`}
      >
        ⚡ EV polnilnice
      </button>
    </div>
  );
}

function CrossBorderCard({
  insight,
  mapsUrl,
}: {
  insight: {
    saving: number;
    homeCountry: string;
    crossCountry?: string | null;
    station: Result;
    isWorthIt: boolean;
  };
  mapsUrl: (item: Result) => string;
}) {
  return (
    <a
      href={mapsUrl(insight.station)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() =>
        trackEvent("navigation_clicked", {
          source: "cross_border_card",
          station_country: insight.station.country_code || null,
          station_brand: insight.station.brand || null,
        })
      }
      className={`mt-3 block w-full max-w-full overflow-hidden rounded-[22px] border p-4 transition ${insight.isWorthIt ? "border-[#b9fb6a]/35 bg-[#b9fb6a]/12 hover:bg-[#b9fb6a]/16" : "border-white/10 bg-white/[0.045] hover:bg-white/[0.07]"}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[.22em] text-[#b9fb6a]">
            Čez mejo
          </div>
          <div className="mt-1 text-lg font-black text-white">
            {insight.isWorthIt
              ? "Čez mejo se lahko splača."
              : "Čez mejo se trenutno ne splača."}
          </div>
          <div className="mt-1 text-sm leading-relaxed text-white/52">
            {insight.isWorthIt
              ? `Najboljša možnost čez mejo prihrani približno ${insight.saving.toFixed(2)} € proti najboljši domači možnosti.`
              : "Cene čez mejo niso dovolj boljše, da bi pokrile dodatno pot in čas."}
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
  );
}

function NumberDark({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-semibold text-white/50">
        {label}
      </span>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          type="number"
          min={0}
          className="h-[56px] sm:h-[64px] w-full rounded-2xl border border-white/10 bg-[#071a12] px-4 pr-24 text-[15px] font-semibold text-white outline-none transition focus:border-[#b9fb6a]/70"
        />
        {suffix && (
          <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-white/35">
            {suffix}
          </div>
        )}
      </div>
    </label>
  );
}

function EvChargeSwitch({
  value,
  onChange,
}: {
  value: EvChargingMode;
  onChange: (value: EvChargingMode) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-white/50">
        Tip polnjenja
      </span>
      <div className="grid h-[56px] grid-cols-2 rounded-2xl border border-white/10 bg-[#071a12] p-1 sm:h-[64px]">
        <button
          type="button"
          onClick={() => onChange("DC")}
          className={`rounded-xl text-xs font-black transition sm:text-sm ${value === "DC" ? "bg-[#b9fb6a] text-[#071a12]" : "text-white/55"}`}
        >
          ⚡ DC hitro
        </button>
        <button
          type="button"
          onClick={() => onChange("AC")}
          className={`rounded-xl text-xs font-black transition sm:text-sm ${value === "AC" ? "bg-[#b9fb6a] text-[#071a12]" : "text-white/55"}`}
        >
          🔌 AC
        </button>
      </div>
    </div>
  );
}

function EvSubscriptionToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="sm:col-span-2">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition ${
          checked
            ? "border-[#b9fb6a]/60 bg-[#b9fb6a]/14"
            : "border-white/10 bg-[#071a12] hover:border-white/18"
        }`}
      >
        <div className="min-w-0">
          <div className="text-xs font-black text-white sm:text-sm">
            Imam EV paket / aplikacijo za ugodnejšo tarifo
          </div>
          <div className="mt-1 text-[11px] font-semibold leading-relaxed text-white/45">
            Upoštevamo nižje cene z zvezdico samo pri ujemajočih se ponudnikih.
          </div>
        </div>
        <span
          className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
            checked
              ? "border-[#b9fb6a] bg-[#b9fb6a]"
              : "border-white/18 bg-white/8"
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
              checked ? "left-6" : "left-1"
            }`}
          />
        </span>
      </button>
    </div>
  );
}

function BrandMultiSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[][];
}) {
  const [open, setOpen] = useState(false);
  const selected = parseBrandSelection(value);
  const selectedSet = new Set(selected);
  const activeCount = selected.length;

  function commit(next: string[]) {
    const clean = Array.from(
      new Set(next.map(normalize).filter(Boolean)),
    ).filter((item) => item !== "ALL");

    onChange(clean.length ? clean.join(",") : "ALL");
  }

  function toggleBrand(nextValue: string) {
    const key = normalize(nextValue);

    if (!key || key === "ALL") {
      onChange("ALL");
      return;
    }

    if (selectedSet.has(key)) {
      commit(selected.filter((item) => item !== key));
      return;
    }

    commit([...selected, key]);
  }

  return (
    <div className="relative">
      <span className="mb-1.5 block text-xs font-semibold text-white/50">
        {label}
      </span>

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-[56px] w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#071a12] px-4 text-left text-[15px] font-semibold text-white outline-none transition hover:border-[#b9fb6a]/45 sm:h-[64px]"
      >
        <span className="min-w-0 truncate">{formatBrandSelection(value)}</span>
        <span className="flex shrink-0 items-center gap-2">
          {activeCount > 0 && (
            <span className="rounded-full bg-[#b9fb6a]/15 px-2 py-1 text-[10px] font-black text-[#b9fb6a]">
              {activeCount}
            </span>
          )}
          <span className="text-white/50">⌄</span>
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 max-h-[310px] overflow-auto rounded-2xl border border-white/12 bg-[#071a12] p-2 shadow-[0_18px_50px_rgba(0,0,0,.45)]">
          <button
            type="button"
            onClick={() => {
              onChange("ALL");
              setOpen(false);
            }}
            className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-black transition ${
              !selected.length
                ? "bg-[#b9fb6a] text-[#071a12]"
                : "text-white/75 hover:bg-white/[0.07]"
            }`}
          >
            <span>Vse znamke</span>
            {!selected.length && <span>✓</span>}
          </button>

          <div className="my-2 h-px bg-white/10" />

          {options
            .filter(([optionValue]) => normalize(optionValue) !== "ALL")
            .map(([optionValue, optionLabel]) => {
              const key = normalize(optionValue);
              const checked = selectedSet.has(key);

              return (
                <button
                  key={optionValue}
                  type="button"
                  onClick={() => toggleBrand(optionValue)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${
                    checked
                      ? "bg-[#b9fb6a]/14 text-[#b9fb6a] ring-1 ring-[#b9fb6a]/20"
                      : "text-white/70 hover:bg-white/[0.07] hover:text-white"
                  }`}
                >
                  <span className="truncate">{optionLabel}</span>
                  <span
                    className={`ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] ${
                      checked
                        ? "border-[#b9fb6a] bg-[#b9fb6a] text-[#071a12]"
                        : "border-white/20 text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                </button>
              );
            })}

          <div className="mt-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[11px] leading-relaxed text-white/42">
            Izbrane znamke uporabimo kot filter. Priporočeno, najcenejše in
            najbližje se nato računajo samo med izbranimi črpalkami.
          </div>
        </div>
      )}
    </div>
  );
}

function SelectDark({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[][];
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-semibold text-white/50">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[56px] sm:h-[64px] w-full appearance-none rounded-2xl border border-white/10 bg-[#071a12] bg-[linear-gradient(45deg,transparent_50%,rgba(255,255,255,.6)_50%),linear-gradient(135deg,rgba(255,255,255,.6)_50%,transparent_50%)] bg-[length:5px_5px,5px_5px] bg-[position:calc(100%-18px)_25px,calc(100%-13px)_25px] sm:bg-[position:calc(100%-18px)_29px,calc(100%-13px)_29px] bg-no-repeat px-4 pr-10 text-[15px] font-semibold text-white outline-none transition focus:border-[#b9fb6a]/70"
      >
        {options.map(([value, label]) => (
          <option key={value} value={value} className="bg-[#071a12] text-white">
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
