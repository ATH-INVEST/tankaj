"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";

type Lang = "sl" | "en";
type Theme = "dark" | "light";
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
const LANG_STORAGE_KEY = "tankaj_lang";
const THEME_STORAGE_KEY = "tankaj_theme";

const TEXT = {
  sl: {
    countries: "Slovenija, Hrvaška, Avstrija, Italija, Nemčija",
    heroTitle: "Ne tankaj več na pamet.",
    heroText:
      "Odpri app, dovoli lokacijo in Tankaj.si sam izračuna najboljšo izbiro. Zdaj podpira goriva in EV polnilnice — z realno potjo, časom in oceno skupnega stroška.",
    hideManual: "Skrij ročni vnos",
    showManual: "Vnesi lokacijo ročno",
    locationSearchLabel: "Lokacija za iskanje",
    locationPlaceholder: "Npr. Ljubljana, Koper, Zagreb ...",
    use: "Uporabi",
    searchingLocation: "Iščem lokacijo ...",
    manualHelp:
      "Uporabno, če imaš sledenje lokacije izklopljeno. Iskanje bo uporabljalo izbrano lokacijo namesto GPS-a.",
    fuel: "Goriva",
    evChargers: "EV polnilnice",
    fuelLabel: "Gorivo",
    petrol95: "Bencin 95",
    petrolE10: "Bencin E10",
    diesel: "Dizel",
    radius: "Radius",
    amount: "Količina",
    brands: "Znamke",
    providers: "Ponudniki",
    advanced: "Napredne nastavitve",
    chargeAmount: "Količina polnjenja",
    carConsumption: "Poraba vozila",
    acPower: "AC moč",
    minPower: "Min. moč",
    allAc: "Vse AC",
    allPowers: "Vse moči",
    country: "Država",
    getLocation: "Pridobivam lokacijo ...",
    calcEv: "Računam EV polnilnice ...",
    calcRoutes: "Računam realne poti ...",
    findEv: "Poišči najboljšo EV polnilnico",
    refreshBest: "Osveži najboljšo izbiro",
    energy: "Energija",
    fuelCost: "Gorivo",
    route: "Pot",
    time: "Čas",
    priceTimesKwh: "Cena × kWh",
    priceTimesAmount: "Cena × količina",
    realDrive: "Realna vožnja",
    defaultHour: "Privzeto 12 €/h",
    settingsNote:
      "Nastavitve si zapomnimo na tej napravi. EV cene so označene kot preverjene ali ocenjene glede na vir podatkov. Cene s paketom so označene z zvezdico in se uporabijo samo, če paket obkljukaš.",
    recommended: "Priporočeno",
    cheapestLiter: "Najcenejše €/L",
    cheapestKwh: "Najcenejše €/kWh",
    nearest: "Najbližje",
    moreEv: "Več EV polnilnic",
    otherOptions: "Druge odlične možnosti",
    prices: "Cene",
    loadingMore: "Računam dodatne možnosti ...",
    showMoreEv: "Prikaži več EV polnilnic",
    showOtherOptions: "Prikaži druge odlične možnosti",
    loadMoreEv: "Naloži več EV polnilnic",
    loadMore5: "Naloži še 5 možnosti",
    allEvShown: "Prikazane so vse izračunane EV polnilnice",
    allShown: "Prikazane so vse izračunane možnosti",
    automaticCalc: "Samodejni izračun",
    allowLocationTitle: "Dovoli lokacijo in rezultat se izračuna sam.",
    location: "Lokacija",
    closestRoutes: "najbližje realne poti",
    parameters: "Parametri",
    paramsText: "gorivo ali EV, radij, količina",
    result: "Rezultat",
    resultText: "ena najboljša izbira + alternative",
    howWorks: "Kako deluje?",
    howWorksText:
      "Tankaj.si samodejno izračuna realne poti do črpalk in EV polnilnic v izbranem radiju. Pri gorivu primerja ceno na liter, pri EV pa ceno na kWh, moč polnilnice, pot in čas. Uporabnik lahko sam določi, ali se pri skupnem strošku upoštevajo energija, pot in čas.",
    formula: "Formula",
    formulaText: "energija + pot + čas",
    radiusText: "Vedno upoštevamo tvoj izbor",
    autoText: "Zadnje nastavitve si zapomnimo",
    evPriceNotes: "Opombe o EV cenah",
    evPriceNotes1:
      "Pri EV polnilnicah najprej uporabljamo preverjene tarife, kjer so javno dostopne. Kjer točne tarife niso javno objavljene, uporabimo referenčno oceno po državi in tipu polnjenja (AC/DC).",
    evPriceNotes2:
      "Referenčni viri vključujejo javne cenike večjih ponudnikov, kot so Petrol, Gremo na elektriko, MOL Plugee, Smatrics, Enel X Way, IONITY in drugi. Dejanska cena se lahko razlikuje glede na aplikacijo, naročnino ali roaming kartico.",
    language: "SL",
    themeLight: "Svetla",
    themeDark: "Temna",
    footerAuthor: "Avtor",
    footerCopyright: "© 2026 Tankaj.si",
    footerContact: "Kontakt na LinkedIn",
    allCountries: "Vse države",
    slovenia: "Slovenija",
    croatia: "Hrvaška",
    austria: "Avstrija",
    italy: "Italija",
    germany: "Nemčija",
    bestOption: "Najboljša izbira",
    bestEvOption: "Najboljša EV izbira",
    fuelPrice: "Cena goriva",
    chargingPrice: "Cena polnjenja",
    drive: "Vožnja",
    estimatedTotalCost: "Ocenjen skupni strošek",
    navigation: "Navigacija",
    share: "Deli",
    copied: "Kopirano ✓",
    actualTariff: "Dejanska tarifa",
    referenceEstimate: "Referenčna ocena",
    source: "Vir",
    fuelReasonSmart: "Najboljša kombinacija izbranih stroškov.",
    fuelReasonPrice: "Najcenejša cena na liter v izbranem radiusu.",
    fuelReasonDistance: "Najbližja črpalka po realni cestni poti.",
    evReasonSmart:
      "Najboljša kombinacija cene polnjenja, poti, časa in moči polnilnice.",
    evReasonPrice: "Najcenejša cena na kWh med prikazanimi polnilnicami.",
    evReasonDistance: "Najbližja EV polnilnica po realni cestni poti.",
    fuelMapsNote:
      "Izračun je ocena poti do črpalke. Google Maps lahko pokaže drugačen čas zaradi prometa ali prehoda meje.",
    evVerifiedNote:
      "Cena polnjenja temelji na znani tarifi, vseeno pred polnjenjem preveri točen cenik pri ponudniku.",
    evEstimatedNote:
      "EV cena je referenčna ocena za državo in tip polnjenja. Dejanska tarifa se lahko razlikuje glede na ponudnika, aplikacijo ali roaming kartico.",
  },
  en: {
    countries: "Slovenia, Croatia, Austria, Italy, Germany",
    heroTitle: "Don’t fuel blindly.",
    heroText:
      "Open the app, allow location and Tankaj.si calculates the best option for you. It now supports fuel and EV chargers — with real routes, time and estimated total cost.",
    hideManual: "Hide manual entry",
    showManual: "Enter location manually",
    locationSearchLabel: "Search location",
    locationPlaceholder: "E.g. Ljubljana, Koper, Zagreb ...",
    use: "Use",
    searchingLocation: "Searching location ...",
    manualHelp:
      "Useful when location tracking is off. Search will use the selected place instead of GPS.",
    fuel: "Fuel",
    evChargers: "EV chargers",
    fuelLabel: "Fuel",
    petrol95: "Petrol 95",
    petrolE10: "Petrol E10",
    diesel: "Diesel",
    radius: "Radius",
    amount: "Amount",
    brands: "Brands",
    providers: "Providers",
    advanced: "Advanced settings",
    chargeAmount: "Charging amount",
    carConsumption: "Car consumption",
    acPower: "AC power",
    minPower: "Min. power",
    allAc: "All AC",
    allPowers: "All powers",
    country: "Country",
    getLocation: "Getting location ...",
    calcEv: "Calculating EV chargers ...",
    calcRoutes: "Calculating real routes ...",
    findEv: "Find the best EV charger",
    refreshBest: "Refresh best option",
    energy: "Energy",
    fuelCost: "Fuel",
    route: "Route",
    time: "Time",
    priceTimesKwh: "Price × kWh",
    priceTimesAmount: "Price × amount",
    realDrive: "Real drive",
    defaultHour: "Default 12 €/h",
    settingsNote:
      "Settings are remembered on this device. EV prices are marked as verified or estimated depending on the data source. Package prices are marked with an asterisk and are only used when enabled.",
    recommended: "Recommended",
    cheapestLiter: "Cheapest €/L",
    cheapestKwh: "Cheapest €/kWh",
    nearest: "Nearest",
    moreEv: "More EV chargers",
    otherOptions: "Other great options",
    prices: "Prices",
    loadingMore: "Calculating more options ...",
    showMoreEv: "Show more EV chargers",
    showOtherOptions: "Show other great options",
    loadMoreEv: "Load more EV chargers",
    loadMore5: "Load 5 more options",
    allEvShown: "All calculated EV chargers are shown",
    allShown: "All calculated options are shown",
    automaticCalc: "Automatic calculation",
    allowLocationTitle:
      "Allow location and the result is calculated automatically.",
    location: "Location",
    closestRoutes: "nearest real routes",
    parameters: "Parameters",
    paramsText: "fuel or EV, radius, amount",
    result: "Result",
    resultText: "one best option + alternatives",
    howWorks: "How it works",
    howWorksText:
      "Tankaj.si automatically calculates real routes to fuel stations and EV chargers in the selected radius. For fuel it compares price per litre; for EV it compares price per kWh, charger power, route and time. You can choose whether energy, route and time are included in the total cost.",
    formula: "Formula",
    formulaText: "energy + route + time",
    radiusText: "Your selected radius is always respected",
    autoText: "Last settings are remembered",
    evPriceNotes: "Notes about EV prices",
    evPriceNotes1:
      "For EV chargers we use verified tariffs first where they are publicly available. Where exact tariffs are not public, we use a reference estimate by country and charging type (AC/DC).",
    evPriceNotes2:
      "Reference sources include public price lists from major providers such as Petrol, Gremo na elektriko, MOL Plugee, Smatrics, Enel X Way, IONITY and others. The actual price may differ depending on app, subscription or roaming card.",
    language: "EN",
    themeLight: "Light",
    themeDark: "Dark",
    footerAuthor: "Author",
    footerCopyright: "© 2026 Tankaj.si",
    footerContact: "Contact on LinkedIn",
    allCountries: "All countries",
    slovenia: "Slovenia",
    croatia: "Croatia",
    austria: "Austria",
    italy: "Italy",
    germany: "Germany",
    bestOption: "Best option",
    bestEvOption: "Best EV option",
    fuelPrice: "Fuel price",
    chargingPrice: "Charging price",
    drive: "Drive",
    estimatedTotalCost: "Estimated total cost",
    navigation: "Navigation",
    share: "Share",
    copied: "Copied ✓",
    actualTariff: "Actual tariff",
    referenceEstimate: "Reference estimate",
    source: "Source",
    fuelReasonSmart: "Best combination of selected costs.",
    fuelReasonPrice: "Cheapest price per litre in the selected radius.",
    fuelReasonDistance: "Nearest fuel station by real road route.",
    evReasonSmart:
      "Best combination of charging price, route, time and charger power.",
    evReasonPrice: "Cheapest price per kWh among shown chargers.",
    evReasonDistance: "Nearest EV charger by real road route.",
    fuelMapsNote:
      "The calculation is an estimate of the route to the station. Google Maps may show a different time due to traffic or border crossing.",
    evVerifiedNote:
      "Charging price is based on a known tariff, but always check the exact price with the provider before charging.",
    evEstimatedNote:
      "The EV price is a reference estimate for the country and charging type. The actual tariff may differ depending on provider, app or roaming card.",
  },
} satisfies Record<Lang, Record<string, string>>;

function tr(lang: Lang | undefined, key: keyof typeof TEXT.sl) {
  const dictionary = lang && TEXT[lang] ? TEXT[lang] : TEXT.sl;
  return dictionary[key] || TEXT.sl[key] || String(key);
}

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
  ["ALL", "allCountries"],
  ["SI", "slovenia"],
  ["HR", "croatia"],
  ["AT", "austria"],
  ["IT", "italy"],
  ["DE", "germany"],
] as const;

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
  const labels: Record<string, string> = {
    SI: "Slovenija",
    HR: "Hrvaška",
    AT: "Avstrija",
    IT: "Italija",
    DE: "Nemčija",
  };

  const normalized = normalize(code);
  return labels[normalized] || normalized || "—";
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
  const knownBrands = [
    "AGIP",
    "ARAL",
    "AVIA",
    "BP",
    "CRODUX",
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
    "LIDL",
    "MAXEN",
    "MOL",
    "OMV",
    "ORLEN",
    "PETROL",
    "Q8",
    "SHELL",
    "STAR",
    "TAMOIL",
    "TESLA",
    "TIFON",
    "TOTALENERGIES",
    "TURMOEL",
  ];

  const match = knownBrands.find((value) => source.includes(value));

  if (!match) return normalize(item.brand) || "";
  if (match === "TURMOEL") return "TURMOEL";
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
    AGIP: "Agip",
    ARAL: "Aral",
    AVIA: "Avia",
    BP: "BP",
    CRODUX: "Crodux",
    DISKONT: "Hofer/Diskont",
    ENI: "Eni",
    ESSO: "Esso",
    GENOL: "Genol",
    HEM: "HEM",
    HOFER: "Hofer/Diskont",
    INA: "INA",
    IP: "IP",
    JET: "JET",
    LAGERHAUS: "Lagerhaus",
    LIDL: "Lidl",
    MAXEN: "Maxen",
    MOL: "MOL",
    OMV: "OMV",
    ORLEN: "Orlen",
    PETROL: "Petrol",
    Q8: "Q8",
    SHELL: "Shell",
    STAR: "Star",
    TAMOIL: "Tamoil",
    TESLA: "Tesla",
    TIFON: "Tifon",
    TOTALENERGIES: "TotalEnergies",
    TURMOEL: "Turmöl",
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

  if (selected === "TURMOEL" || selected === "TURMÖL") {
    return source.includes("TURMÖL") || source.includes("TURMOEL");
  }

  if (selected === "ENI" || selected === "AGIP") {
    return source.includes("ENI") || source.includes("AGIP");
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

function reasonBySort(sortBy: SortBy, mode: SearchMode, lang: Lang) {
  if (mode === "ev") {
    if (sortBy === "price") return tr(lang, "evReasonPrice");
    if (sortBy === "distance") return tr(lang, "evReasonDistance");
    return tr(lang, "evReasonSmart");
  }

  if (sortBy === "price") return tr(lang, "fuelReasonPrice");
  if (sortBy === "distance") return tr(lang, "fuelReasonDistance");
  return tr(lang, "fuelReasonSmart");
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
  const [lang, setLang] = useState<Lang>("sl");
  const [theme, setTheme] = useState<Theme>("dark");
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
      const savedLang = window.localStorage.getItem(LANG_STORAGE_KEY);
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

      if (savedLang === "sl" || savedLang === "en") setLang(savedLang);
      if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
      document.documentElement.lang = lang;
    } catch {}
  }, [lang]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      document.documentElement.classList.toggle("light", theme === "light");
      document.documentElement.classList.toggle("dark", theme === "dark");
    } catch {}
  }, [theme]);

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
      "ARAL",
      "ESSO",
      "JET",
      "AVIA",
      "HEM",
      "STAR",
      "ORLEN",
      "TOTALENERGIES",
      "BP",
      "ENI",
      "AGIP",
      "HOFER",
      "DISKONT",
      "TURMÖL",
      "GENOL",
      "INA",
      "TIFON",
      "CRODUX",
      "Q8",
      "IP",
      "TAMOIL",
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
      className={`relative min-h-dvh w-full max-w-[100svw] overflow-x-clip pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-0 ${theme === "light" ? "bg-[#f6f4ec] text-[#071a12]" : "bg-[#06140f] text-white"}`}
    >
      <style jsx global>
        {`
          :root {
            color-scheme: dark;
          }
          html.light {
            color-scheme: light;
          }

          html,
          body {
            max-width: 100%;
            overflow-x: hidden;
            overscroll-behavior-x: none;
          }

          body {
            -webkit-font-smoothing: antialiased;
            text-rendering: geometricPrecision;
          }

          #top,
          #top * {
            box-sizing: border-box;
          }
          #top button,
          #top input,
          #top select {
            -webkit-tap-highlight-color: transparent;
          }

          #top button:focus-visible,
          #top a:focus-visible,
          #top input:focus-visible,
          #top select:focus-visible {
            outline: 3px solid rgba(185, 251, 106, 0.55);
            outline-offset: 3px;
          }

          html.light body {
            background: #f4f6ef;
          }

          html.light #top {
            background: #f4f6ef !important;
            color: #071a12 !important;
          }

          html.light #top > .pointer-events-none.fixed {
            background:
              radial-gradient(
                circle at 12% 0%,
                rgba(185, 251, 106, 0.24),
                transparent 28%
              ),
              radial-gradient(
                circle at 90% 5%,
                rgba(57, 116, 77, 0.14),
                transparent 32%
              ),
              linear-gradient(180deg, #f7faee 0%, #f2f1e8 48%, #ece8dc 100%) !important;
          }

          html.light #top [class*="rounded-[30px]"],
          html.light #top [class*="rounded-[28px]"],
          html.light #top [class*="rounded-[26px]"],
          html.light #top [class*="rounded-[24px]"],
          html.light #top [class*="rounded-3xl"] {
            border-color: rgba(15, 31, 22, 0.09) !important;
            box-shadow: 0 24px 70px rgba(32, 45, 37, 0.1) !important;
          }

          html.light #top [class*="bg-white/["],
          html.light #top [class*="bg-white/"],
          html.light #top [class*="bg-[#123024]"],
          html.light #top [class*="bg-[#071a12]"],
          html.light #top [class*="bg-black/"],
          html.light #top [class*="bg-[radial-gradient"] {
            background: rgba(255, 255, 255, 0.88) !important;
            backdrop-filter: blur(22px) saturate(160%);
          }

          html.light #top [class*="bg-[#071a12]/62"],
          html.light #top [class*="bg-[#071a12]/55"],
          html.light #top [class*="bg-[#123024]/72"],
          html.light #top [class*="bg-black/15"],
          html.light #top [class*="bg-black/25"],
          html.light #top [class*="bg-black/30"] {
            background: #ffffff !important;
          }

          html.light #top [class*="border-white"] {
            border-color: rgba(7, 26, 18, 0.1) !important;
          }

          html.light #top [class*="text-white"],
          html.light #top [class*="text-zinc"],
          html.light #top [class*="text-neutral"],
          html.light #top [class*="text-slate"] {
            color: rgba(7, 26, 18, 0.66) !important;
          }

          html.light #top h1,
          html.light #top h2,
          html.light #top h3,
          html.light #top strong,
          html.light #top [class~="text-white"],
          html.light #top [class*="font-black"] {
            color: #071a12 !important;
          }

          html.light #top [class*="text-white/80"],
          html.light #top [class*="text-white/75"],
          html.light #top [class*="text-white/72"],
          html.light #top [class*="text-white/70"],
          html.light #top [class*="text-white/65"],
          html.light #top [class*="text-white/60"] {
            color: rgba(7, 26, 18, 0.72) !important;
          }

          html.light #top [class*="text-white/55"],
          html.light #top [class*="text-white/45"],
          html.light #top [class*="text-white/40"],
          html.light #top [class*="text-white/38"],
          html.light #top [class*="text-white/35"],
          html.light #top [class*="text-white/30"] {
            color: rgba(7, 26, 18, 0.46) !important;
          }

          html.light #top [class*="text-[#b9fb6a]"] {
            color: #4f8f18 !important;
          }

          html.light #top [class*="bg-[#b9fb6a]"] {
            background-color: #a8f451 !important;
            color: #06170f !important;
            box-shadow: 0 12px 30px rgba(106, 169, 31, 0.18) !important;
          }

          html.light #top [class*="bg-[#b9fb6a]/"],
          html.light #top [class*="bg-[#b9fb6a]/18"],
          html.light #top [class*="bg-[#b9fb6a]/14"],
          html.light #top [class*="bg-[#b9fb6a]/12"],
          html.light #top [class*="bg-[#b9fb6a]/10"] {
            background-color: rgba(168, 244, 81, 0.16) !important;
          }

          html.light #top input,
          html.light #top select {
            background: #f8faf5 !important;
            border: 1px solid rgba(7, 26, 18, 0.11) !important;
            color: #071a12 !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9) !important;
          }

          html.light #top input::placeholder {
            color: rgba(7, 26, 18, 0.36) !important;
          }

          html.light select option {
            color: #071a12;
            background: #ffffff;
          }

          html.light #top [class*="hover:bg-white"]:hover {
            background-color: rgba(7, 26, 18, 0.045) !important;
          }

          html.light #top [class*="shadow-[0_25px_80px"] {
            box-shadow: 0 34px 90px rgba(32, 45, 37, 0.13) !important;
          }

          html.light #top [class*="tracking-[.28em]"],
          html.light #top [class*="tracking-[.2em]"] {
            color: #5c961f !important;
          }

          html.light #top .line-clamp-2 {
            color: rgba(7, 26, 18, 0.48) !important;
          }

          /* 2026 iOS polish pass */
          #top {
            font-family:
              Inter,
              ui-sans-serif,
              system-ui,
              -apple-system,
              BlinkMacSystemFont,
              "SF Pro Display",
              "SF Pro Text",
              "Segoe UI",
              sans-serif;
          }

          #top > section > div.grid {
            align-items: stretch;
            margin-inline: auto;
          }

          #top input,
          #top select {
            min-height: 58px;
            border-radius: 18px !important;
          }

          html.light #top {
            background: #f7f8f3 !important;
          }

          html.light #top > .pointer-events-none.fixed {
            background:
              radial-gradient(
                circle at 13% 2%,
                rgba(185, 251, 106, 0.22),
                transparent 31%
              ),
              radial-gradient(
                circle at 82% 8%,
                rgba(65, 121, 82, 0.1),
                transparent 33%
              ),
              radial-gradient(
                circle at 50% 105%,
                rgba(214, 205, 181, 0.34),
                transparent 44%
              ),
              linear-gradient(180deg, #fafcf5 0%, #f5f6ef 50%, #ece9df 100%) !important;
          }

          html.light #top > section > div.grid > div,
          html.light #how-it-works,
          html.light #app-footer {
            background: rgba(255, 255, 255, 0.92) !important;
            border: 1px solid rgba(12, 26, 18, 0.075) !important;
            box-shadow:
              0 26px 70px rgba(24, 35, 28, 0.105),
              0 1px 0 rgba(255, 255, 255, 0.78) inset !important;
            backdrop-filter: blur(26px) saturate(165%);
          }

          html.light #top h1,
          html.light #top h2,
          html.light #top h3 {
            color: #071a12 !important;
          }

          html.light #top p,
          html.light #top label,
          html.light #top small {
            color: rgba(7, 26, 18, 0.62) !important;
          }

          html.light #top input,
          html.light #top select {
            background: #ffffff !important;
            border: 1px solid rgba(7, 26, 18, 0.1) !important;
            color: #071a12 !important;
            box-shadow:
              0 1px 0 rgba(255, 255, 255, 0.95) inset,
              0 10px 24px rgba(32, 45, 37, 0.035) !important;
          }

          html.light #top input:hover,
          html.light #top select:hover {
            border-color: rgba(87, 145, 39, 0.24) !important;
          }

          html.light #top input:focus,
          html.light #top select:focus {
            border-color: rgba(137, 230, 52, 0.92) !important;
            box-shadow:
              0 0 0 4px rgba(185, 251, 106, 0.26),
              0 12px 28px rgba(69, 122, 37, 0.08) !important;
          }

          html.light #top input::placeholder {
            color: rgba(7, 26, 18, 0.35) !important;
          }

          html.light #top [class*="bg-black/15"],
          html.light #top [class*="bg-black/20"],
          html.light #top [class*="bg-black/25"],
          html.light #top [class*="bg-black/30"],
          html.light #top [class*="bg-white/[0.05]"],
          html.light #top [class*="bg-white/[0.055]"],
          html.light #top [class*="bg-white/[0.06]"] {
            background: rgba(255, 255, 255, 0.72) !important;
          }

          html.light #top [class*="border-white/10"],
          html.light #top [class*="border-white/12"],
          html.light #top [class*="border-white/15"] {
            border-color: rgba(7, 26, 18, 0.085) !important;
          }

          html.light #top [class*="text-white/90"],
          html.light #top [class*="text-white/85"],
          html.light #top [class*="text-white/80"],
          html.light #top [class*="text-white/75"],
          html.light #top [class*="text-white/70"] {
            color: rgba(7, 26, 18, 0.72) !important;
          }

          html.light #top [class*="text-white/65"],
          html.light #top [class*="text-white/60"],
          html.light #top [class*="text-white/55"] {
            color: rgba(7, 26, 18, 0.56) !important;
          }

          html.light #top [class*="text-white/45"],
          html.light #top [class*="text-white/40"],
          html.light #top [class*="text-white/35"],
          html.light #top [class*="text-white/30"] {
            color: rgba(7, 26, 18, 0.42) !important;
          }

          html.light #top [class*="bg-[#b9fb6a]"] {
            background-color: #9cf23e !important;
            color: #071a12 !important;
            box-shadow: 0 14px 32px rgba(112, 176, 38, 0.22) !important;
          }

          html.light #top [class*="text-[#b9fb6a]"] {
            color: #4d8f18 !important;
          }

          html.light #top [class*="bg-[#b9fb6a]/"] {
            background-color: rgba(156, 242, 62, 0.16) !important;
            color: #3f7416 !important;
          }

          html.light #top a[class*="bg-white"],
          html.light #top button[class*="bg-white"] {
            background: #072116 !important;
            color: #ffffff !important;
            border-color: rgba(7, 33, 22, 0.12) !important;
            box-shadow: 0 18px 38px rgba(7, 33, 22, 0.14) !important;
          }

          html.dark #top > section > div.grid > div,
          html.dark #how-it-works,
          html.dark #app-footer {
            border-color: rgba(255, 255, 255, 0.11) !important;
            box-shadow: 0 30px 90px rgba(0, 0, 0, 0.34) !important;
          }

          @media (min-width: 1024px) {
            #top > section > div.grid > div {
              border-radius: 34px !important;
            }
          }

          @media (max-width: 640px) {
            #top > section {
              padding-inline: 12px !important;
              padding-top: 12px !important;
            }
            #top > section > div.grid > div,
            #how-it-works,
            #app-footer {
              border-radius: 28px !important;
            }
            #top input,
            #top select {
              min-height: 56px;
            }
          }

          @media (max-width: 640px) {
            #top h1 {
              letter-spacing: -0.062em;
            }
          }
          /* Final production UI pass — LIGHT MODE ONLY. Dark mode intentionally stays identical to previous approved version. */
          html.light #top {
            --tankaj-ink: #071a12;
            --tankaj-muted: rgba(7, 26, 18, 0.6);
            --tankaj-card-strong: rgba(255, 255, 255, 0.985);
            --tankaj-border: rgba(10, 28, 19, 0.085);
            --tankaj-shadow-soft: 0 24px 72px rgba(25, 35, 29, 0.105);
            letter-spacing: -0.01em;
            background: #f7f8fa !important;
          }

          html.light body {
            background: #f7f8fa !important;
          }

          html.light #top > .pointer-events-none.fixed {
            background:
              radial-gradient(
                circle at 17% 0%,
                rgba(185, 251, 106, 0.18),
                transparent 30%
              ),
              radial-gradient(
                circle at 86% 7%,
                rgba(40, 111, 73, 0.08),
                transparent 34%
              ),
              linear-gradient(180deg, #fbfcf8 0%, #f7f8fa 47%, #efede6 100%) !important;
          }

          html.light #top > section {
            max-width: 1280px !important;
          }
          html.light #top > section > div.grid {
            gap: 22px !important;
          }

          @media (min-width: 1024px) {
            html.light #top > section > div.grid > div {
              min-height: 760px;
            }
          }

          html.light #top > section > div.grid > div,
          html.light #how-it-works,
          html.light #app-footer {
            background: var(--tankaj-card-strong) !important;
            border-color: var(--tankaj-border) !important;
            box-shadow:
              var(--tankaj-shadow-soft),
              0 1px 0 rgba(255, 255, 255, 0.9) inset !important;
          }

          html.light #top h1 {
            letter-spacing: -0.07em !important;
            line-height: 0.94 !important;
          }
          html.light #top h2,
          html.light #top h3 {
            letter-spacing: -0.045em !important;
          }

          html.light #top h1,
          html.light #top h2,
          html.light #top h3,
          html.light #top [class*="font-black"] {
            color: var(--tankaj-ink) !important;
          }

          html.light #top p,
          html.light #top [class*="text-white/60"],
          html.light #top [class*="text-white/65"],
          html.light #top [class*="text-white/70"] {
            color: var(--tankaj-muted) !important;
          }

          html.light #top input,
          html.light #top select {
            background: linear-gradient(
              180deg,
              #ffffff 0%,
              #fbfcfa 100%
            ) !important;
            border-color: rgba(7, 26, 18, 0.095) !important;
            color: #071a12 !important;
            box-shadow:
              0 1px 0 rgba(255, 255, 255, 0.95) inset,
              0 10px 24px rgba(21, 35, 28, 0.038) !important;
          }

          html.light #top input:focus,
          html.light #top select:focus {
            border-color: rgba(143, 232, 56, 0.9) !important;
            box-shadow:
              0 0 0 4px rgba(185, 251, 106, 0.24),
              0 14px 32px rgba(78, 139, 37, 0.09) !important;
          }

          html.light #top [class*="bg-[#b9fb6a]"] {
            background: linear-gradient(
              180deg,
              #b9fb6a 0%,
              #95ef32 100%
            ) !important;
            color: #06170f !important;
            box-shadow: 0 14px 34px rgba(112, 176, 38, 0.22) !important;
          }

          html.light #top [class*="bg-[#b9fb6a]/"] {
            background: rgba(185, 251, 106, 0.16) !important;
            color: #477a16 !important;
            box-shadow: none !important;
          }

          html.light #top button,
          html.light #top a {
            transform: translateZ(0);
          }
          html.light #top button:hover,
          html.light #top a:hover {
            filter: saturate(1.04);
          }
          html.light #top button:active,
          html.light #top a:active {
            transform: scale(0.985) translateZ(0);
          }

          html.light #top a[class*="bg-white"],
          html.light #top button[class*="bg-white"] {
            background: linear-gradient(
              180deg,
              #092719 0%,
              #061a11 100%
            ) !important;
            color: #ffffff !important;
            border-color: rgba(7, 26, 18, 0.14) !important;
            box-shadow: 0 16px 38px rgba(7, 26, 18, 0.17) !important;
          }

          html.light #top [class*="text-[#b9fb6a]"] {
            color: #4e8d18 !important;
          }

          html.light #how-it-works {
            background: rgba(255, 255, 255, 0.96) !important;
          }

          html.light #how-it-works [class*="bg-white/"] {
            background: #fbfcf9 !important;
            box-shadow: 0 10px 28px rgba(21, 35, 28, 0.045) !important;
          }

          html.light #app-footer a {
            color: #477a16 !important;
          }

          @media (max-width: 1023px) {
            html.light #top > section {
              max-width: 560px !important;
            }
            html.light #top > section > div.grid > div {
              min-height: auto;
            }
          }

          html.light .other-option-card {
            background: #ffffff;
            border: 1px solid #e6e9e4;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.06);
            color: #0f1720;
          }

          html.light .other-option-card .title {
            color: #0f1720;
          }

          html.light .other-option-card .price {
            color: #16a34a; /* zelena, ampak readable */
          }

          html.light .other-option-card .meta {
            color: #6b7280;
          }

          html.light .other-option-card:hover {
            transform: translateY(-1px);
            box-shadow: 0 10px 28px rgba(0, 0, 0, 0.08);
          }

          /* Final light-mode cards + disabled metric pills. Dark mode is intentionally untouched. */
          html.light #top .compact-result-card {
            background: linear-gradient(
              180deg,
              #ffffff 0%,
              #f7ffef 100%
            ) !important;
            border: 1px solid rgba(144, 222, 74, 0.34) !important;
            color: #071a12 !important;
            box-shadow:
              0 14px 34px rgba(24, 35, 28, 0.075),
              0 1px 0 rgba(255, 255, 255, 0.95) inset !important;
          }

          html.light #top .compact-result-card:hover {
            background: linear-gradient(
              180deg,
              #fbfff6 0%,
              #efffdd 100%
            ) !important;
            border-color: rgba(144, 222, 74, 0.58) !important;
            transform: translateY(-1px);
            box-shadow:
              0 18px 42px rgba(24, 35, 28, 0.105),
              0 1px 0 rgba(255, 255, 255, 0.98) inset !important;
          }

          html.light #top .compact-result-card .compact-title,
          html.light #top .compact-result-card .compact-distance {
            color: #071a12 !important;
          }

          html.light #top .compact-result-card .compact-meta,
          html.light #top .compact-result-card [class*="text-white/38"],
          html.light #top .compact-result-card [class*="text-white/40"],
          html.light #top .compact-result-card [class*="text-white/55"],
          html.light #top .compact-result-card [class*="text-white/70"] {
            color: rgba(7, 26, 18, 0.48) !important;
          }

          html.light #top .compact-result-card .compact-price,
          html.light #top .compact-result-card .compact-total {
            color: #4e8d18 !important;
          }

          html.light #top .toggle-info.is-inactive {
            opacity: 1 !important;
            background: linear-gradient(
              180deg,
              #ffffff 0%,
              #fbfcf8 100%
            ) !important;
            border-color: rgba(7, 26, 18, 0.1) !important;
            box-shadow: 0 8px 22px rgba(21, 35, 28, 0.04) !important;
          }

          html.light #top .toggle-info.is-inactive div {
            color: rgba(7, 26, 18, 0.48) !important;
          }

          html.light
            #top
            .toggle-info.is-inactive
            > div:first-child
            > div:first-child {
            color: rgba(7, 26, 18, 0.62) !important;
          }

          html.light #top .toggle-info.is-active {
            opacity: 1 !important;
            background: linear-gradient(
              180deg,
              rgba(240, 255, 225, 0.96) 0%,
              rgba(250, 255, 244, 0.98) 100%
            ) !important;
            border-color: rgba(144, 222, 74, 0.46) !important;
            box-shadow: 0 10px 26px rgba(112, 176, 38, 0.09) !important;
          }

          @media (max-width: 640px) {
            html.light #top > section {
              padding-inline: 10px !important;
            }
            html.light #top h1 {
              font-size: clamp(3.2rem, 16vw, 4.9rem) !important;
            }
            html.light #top > section > div.grid {
              gap: 12px !important;
            }
          }

          html.light #top a.compact-result-card,
          html.light #top a.compact-result-card[class*="bg-white"] {
            background: linear-gradient(
              180deg,
              #ffffff 0%,
              #f4fee9 100%
            ) !important;
            border: 1px solid rgba(144, 222, 74, 0.56) !important;
            color: #071a12 !important;
            box-shadow:
              0 14px 34px rgba(24, 35, 28, 0.075),
              0 1px 0 rgba(255, 255, 255, 0.95) inset !important;
          }

          html.light #top a.compact-result-card:hover,
          html.light #top a.compact-result-card[class*="bg-white"]:hover {
            background: linear-gradient(
              180deg,
              #ffffff 0%,
              #efffdd 100%
            ) !important;
            border-color: rgba(144, 222, 74, 0.72) !important;
            transform: translateY(-1px);
          }

          html.light #top a.compact-result-card .compact-title,
          html.light #top a.compact-result-card .compact-distance {
            color: #071a12 !important;
          }

          html.light #top a.compact-result-card .compact-meta {
            color: rgba(7, 26, 18, 0.52) !important;
          }

          html.light #top a.compact-result-card .compact-price,
          html.light #top a.compact-result-card .compact-total {
            color: #4e8d18 !important;
          }

          /* Winner card highlight */
          #top .winner-card {
            position: relative;
            transform: scale(1.012);
          }

          #top .winner-card::before {
            content: "";
            position: absolute;
            inset: -1px;
            border-radius: inherit;
            pointer-events: none;
            background: linear-gradient(
              135deg,
              rgba(185, 251, 106, 0.55),
              rgba(185, 251, 106, 0.08),
              rgba(255, 255, 255, 0.08)
            );
            opacity: 0.65;
            z-index: -1;
          }

          #top .winner-card {
            box-shadow:
              0 0 0 1px rgba(185, 251, 106, 0.28),
              0 22px 70px rgba(185, 251, 106, 0.12),
              0 24px 70px rgba(0, 0, 0, 0.22) !important;
          }

          html.light #top .winner-card {
            box-shadow:
              0 0 0 1px rgba(139, 222, 74, 0.32),
              0 24px 70px rgba(112, 176, 38, 0.14),
              0 24px 70px rgba(24, 35, 28, 0.08) !important;
          }

          html.light #top .winner-card::before {
            background: linear-gradient(
              135deg,
              rgba(139, 222, 74, 0.42),
              rgba(139, 222, 74, 0.08),
              rgba(255, 255, 255, 0.6)
            );
          }

          #top .winner-card-pulse {
            position: relative;
          }

          #top .winner-card-pulse::after {
            content: "";
            position: absolute;
            inset: -2px;
            border-radius: inherit;
            pointer-events: none;
            border: 2px solid rgba(185, 251, 106, 0.65);
            box-shadow:
              0 0 0 1px rgba(185, 251, 106, 0.25),
              0 0 20px rgba(185, 251, 106, 0.12);
          }

          @keyframes winnerPulse {
            0% {
              border-color: rgba(185, 251, 106, 0.95);
              box-shadow:
                0 18px 60px rgba(0, 0, 0, 0.24),
                inset 0 0 0 1px rgba(185, 251, 106, 0.46),
                0 0 0 rgba(185, 251, 106, 0);
            }
            42% {
              border-color: rgba(185, 251, 106, 0.95);
              box-shadow:
                0 18px 60px rgba(0, 0, 0, 0.24),
                inset 0 0 0 1px rgba(185, 251, 106, 0.5),
                0 0 42px rgba(185, 251, 106, 0.2);
            }
            100% {
              border-color: rgba(185, 251, 106, 0.7);
              box-shadow:
                0 18px 60px rgba(0, 0, 0, 0.24),
                inset 0 0 0 1px rgba(185, 251, 106, 0.32);
            }
          }

          @keyframes winnerRingPulse {
            0% {
              opacity: 0;
              transform: scale(0.985);
            }
            18% {
              opacity: 1;
            }
            100% {
              opacity: 0;
              transform: scale(1.035);
            }
          }

          html.light #top .winner-card-pulse::after {
            border-color: rgba(106, 169, 31, 0.55);
            box-shadow:
              0 0 0 1px rgba(106, 169, 31, 0.18),
              0 0 34px rgba(106, 169, 31, 0.16);
          }

          @media (prefers-reduced-motion: reduce) {
            #top .winner-card-pulse,
            #top .winner-card-pulse::after {
              animation: none;
            }
          }

          @keyframes winnerBreath {
            0%,
            100% {
              border-color: rgba(185, 251, 106, 0.65);
              box-shadow:
                0 18px 60px rgba(0, 0, 0, 0.24),
                inset 0 0 0 1px rgba(185, 251, 106, 0.28),
                0 0 0 rgba(185, 251, 106, 0);
            }

            50% {
              border-color: rgba(185, 251, 106, 0.9);
              box-shadow:
                0 18px 60px rgba(0, 0, 0, 0.24),
                inset 0 0 0 1px rgba(185, 251, 106, 0.4),
                0 0 36px rgba(185, 251, 106, 0.18);
            }
          }

          @keyframes winnerRingBreath {
            0%,
            100% {
              opacity: 0.35;
              transform: scale(1);
            }

            50% {
              opacity: 0.9;
              transform: scale(1.03);
            }
          }

          html.dark #top .winner-card {
            border-color: rgba(185, 251, 106, 0.45);
            background: rgba(7, 26, 18, 0.65);
            box-shadow:
              0 18px 60px rgba(0, 0, 0, 0.24),
              inset 0 0 0 1px rgba(185, 251, 106, 0.25);
          }

          html.light #top .winner-card {
            border-color: rgba(185, 251, 106, 0.6);
            background: #ffffff;
            box-shadow:
              0 10px 30px rgba(0, 0, 0, 0.08),
              0 0 0 1px rgba(185, 251, 106, 0.15);
          }
        `}
      </style>
      <div
        className={`pointer-events-none fixed inset-0 ${theme === "light" ? "bg-[radial-gradient(circle_at_18%_0%,rgba(185,251,106,.28),transparent_28%),radial-gradient(circle_at_92%_12%,rgba(44,120,76,.13),transparent_34%),linear-gradient(180deg,#f7f4ec_0%,#ebe6d8_100%)]" : "bg-[radial-gradient(circle_at_18%_0%,rgba(185,251,106,.23),transparent_28%),radial-gradient(circle_at_92%_12%,rgba(44,120,76,.24),transparent_34%),linear-gradient(180deg,#071a12_0%,#04100b_100%)]"}`}
      />

      <section className="relative mx-auto flex min-h-dvh w-full max-w-[1280px] min-w-0 flex-col px-3 py-3 sm:px-6 lg:px-8 lg:py-7">
        <div className="grid w-full min-w-0 flex-1 gap-4 lg:grid-cols-2 xl:gap-6">
          <HeroSearch
            lang={lang}
            setLang={setLang}
            theme={theme}
            setTheme={setTheme}
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
            lang={lang}
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

        <HowItWorks lang={lang} />
        <AppFooter lang={lang} />
      </section>
    </main>
  );
}

function HeroSearch({
  lang,
  setLang,
  theme,
  setTheme,
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
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-3xl font-black italic tracking-tight sm:text-4xl">
          Tankaj<span className="text-[#b9fb6a]">.si</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setLang(lang === "sl" ? "en" : "sl")}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.08] px-3 text-xs font-black text-white/75 transition hover:border-[#b9fb6a]/30 hover:text-white"
            aria-label="Change language"
          >
            <span>🌐</span>
            <span>{tr(lang, "language")}</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-sm text-white/75 transition hover:border-[#b9fb6a]/30 hover:text-white"
            aria-label="Toggle theme"
            title={
              theme === "dark" ? tr(lang, "themeLight") : tr(lang, "themeDark")
            }
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <div className="rounded-full bg-[#b9fb6a]/18 px-3 py-1 text-xs font-black tracking-wide text-[#b9fb6a]">
            BETA
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 text-sm text-white/58">
        <span className="text-[#b9fb6a]">⌖</span>
        <span>Slovenija, Hrvaška, Avstrija, Italija, Nemčija</span>
      </div>

      <h1 className="mt-6 max-w-xl text-[42px] font-black leading-[.94] tracking-[-.055em] min-[380px]:text-[50px] sm:text-[64px] lg:text-[72px] xl:text-[78px]">
        {tr(lang, "heroTitle")}
      </h1>

      <p className="mt-5 max-w-lg text-base leading-relaxed text-white/60 sm:text-lg">
        {tr(lang, "heroText")}
      </p>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowManualLocation((v: boolean) => !v)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-sm font-black text-white/70 transition hover:border-[#b9fb6a]/30 hover:text-white"
        >
          <span>⌖</span>
          <span>
            {showManualLocation
              ? tr(lang, "hideManual")
              : tr(lang, "showManual")}
          </span>
        </button>

        {showManualLocation && (
          <div className="mt-3 rounded-[22px] border border-white/10 bg-[#071a12]/62 p-3">
            <label className="block text-xs font-black text-white/45">
              {tr(lang, "locationSearchLabel")}
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
                placeholder={tr(lang, "locationPlaceholder")}
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
                {tr(lang, "use")}
              </button>
            </div>

            {manualLocationLoading && (
              <div className="mt-2 text-xs font-semibold text-white/45">
                {tr(lang, "searchingLocation")}
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
              {tr(lang, "manualHelp")}
            </div>
          </div>
        )}
      </div>

      <ModeSwitch lang={lang} mode={mode} setMode={setMode} />

      <div className="mt-4 w-full min-w-0 max-w-full overflow-visible rounded-[26px] border border-white/10 bg-[#123024]/72 p-3 sm:p-4 lg:p-5">
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 items-end">
          {mode === "fuel" ? (
            <>
              <SelectDark
                lang={lang}
                label={tr(lang, "fuelLabel")}
                value={fuelType}
                onChange={setFuelType}
                options={[
                  ["PETROL_95", tr(lang, "petrol95")],
                  ...(country === "DE" || country === "ALL"
                    ? ([["PETROL_E10", tr(lang, "petrolE10")]] as [
                        string,
                        string,
                      ][])
                    : []),
                  ["DIESEL", tr(lang, "diesel")],
                ]}
              />
              <SelectDark
                lang={lang}
                label={tr(lang, "radius")}
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
                label={tr(lang, "amount")}
                suffix="L"
                value={amount}
                onChange={setAmount}
              />
              <BrandMultiSelect
                label={tr(lang, "brands")}
                value={brand}
                onChange={setBrand}
                options={brandOptions}
              />
              <SelectDark
                lang={lang}
                label={tr(lang, "country")}
                value={country}
                onChange={setCountry}
                options={COUNTRY_OPTIONS}
              />
            </>
          ) : (
            <>
              <EvChargeSwitch
                lang={lang}
                value={evChargingMode}
                onChange={setEvChargingMode}
              />

              <SelectDark
                lang={lang}
                label={tr(lang, "radius")}
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
                <span>{tr(lang, "advanced")}</span>
                <span className="text-lg text-[#b9fb6a]">
                  {showEvAdvanced ? "−" : "+"}
                </span>
              </button>

              {showEvAdvanced && (
                <div className="sm:col-span-2 grid grid-cols-1 gap-4 rounded-2xl border border-white/10 bg-black/15 p-3 sm:grid-cols-2">
                  <NumberDark
                    label={tr(lang, "chargeAmount")}
                    suffix="kWh"
                    value={evAmountKwh}
                    onChange={setEvAmountKwh}
                  />

                  <NumberDark
                    label={tr(lang, "carConsumption")}
                    suffix="kWh/100 km"
                    value={evConsumptionKwh100}
                    onChange={setEvConsumptionKwh100}
                  />

                  <SelectDark
                    lang={lang}
                    label={
                      evChargingMode === "AC"
                        ? tr(lang, "acPower")
                        : tr(lang, "minPower")
                    }
                    value={String(evMinPowerKw)}
                    onChange={(v) => setEvMinPowerKw(Number(v))}
                    options={
                      evChargingMode === "AC"
                        ? [
                            ["0", tr(lang, "allAc")],
                            ["11", "Do 11 kW"],
                            ["22", "22 kW+"],
                          ]
                        : [
                            ["0", tr(lang, "allPowers")],
                            ["30", "30 kW+"],
                            ["50", "50 kW+"],
                            ["100", "100 kW+"],
                            ["150", "150 kW+"],
                          ]
                    }
                  />
                </div>
              )}

              <EvSubscriptionToggle
                lang={lang}
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
              ? tr(lang, "getLocation")
              : status === "routing"
                ? mode === "ev"
                  ? tr(lang, "calcEv")
                  : tr(lang, "calcRoutes")
                : mode === "ev"
                  ? tr(lang, "findEv")
                  : tr(lang, "refreshBest")}
          </button>
        </div>
      </div>

      <div className="mt-4 grid min-w-0 grid-cols-3 gap-2 [&>*]:min-w-0">
        <ToggleInfo
          title={mode === "ev" ? tr(lang, "energy") : tr(lang, "fuelCost")}
          text={
            mode === "ev"
              ? tr(lang, "priceTimesKwh")
              : tr(lang, "priceTimesAmount")
          }
          active={includeFuel}
          onClick={() => setIncludeFuel((v: boolean) => !v)}
        />
        <ToggleInfo
          title={tr(lang, "route")}
          text={tr(lang, "realDrive")}
          active={includePath}
          onClick={() => setIncludePath((v: boolean) => !v)}
        />
        <ToggleInfo
          title={tr(lang, "time")}
          text={tr(lang, "defaultHour")}
          active={includeTime}
          onClick={() => setIncludeTime((v: boolean) => !v)}
        />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-white/35">
        {tr(lang, "settingsNote")}
      </p>
    </div>
  );
}

function ResultPanel({
  lang,
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
  const sortOptions: [SortBy, string][] =
    mode === "ev"
      ? [
          ["smart", tr(lang, "recommended")],
          ["price", tr(lang, "cheapestKwh")],
          ["distance", tr(lang, "nearest")],
        ]
      : [
          ["smart", tr(lang, "recommended")],
          ["price", tr(lang, "cheapestLiter")],
          ["distance", tr(lang, "nearest")],
        ];

  return (
    <div
      id="result"
      className="w-full min-w-0 max-w-full overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(185,251,106,.18),transparent_32%),linear-gradient(180deg,rgba(15,48,34,.86),rgba(5,20,14,.88))] p-4 shadow-[0_25px_80px_rgba(0,0,0,.25)] backdrop-blur-2xl sm:p-6 lg:min-h-[720px] lg:p-8"
    >
      {loading && <LoadingState lang={lang} status={status} />}

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
      {!searched && !loading && <ExampleState lang={lang} />}

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
            lang={lang}
            item={{
              ...best,
              recommendation_reason: reasonBySort(sortBy, mode, lang),
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
                    ? tr(lang, "moreEv")
                    : tr(lang, "otherOptions")}
                </h2>
                {lastUpdated && (
                  <div className="shrink-0 whitespace-nowrap text-xs text-white/40">
                    {tr(lang, "prices")} {lastUpdated}
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
                  ? tr(lang, "loadingMore")
                  : !showOthers
                    ? mode === "ev"
                      ? tr(lang, "showMoreEv")
                      : tr(lang, "showOtherOptions")
                    : hasMore
                      ? mode === "ev"
                        ? tr(lang, "loadMoreEv")
                        : tr(lang, "loadMore5")
                      : mode === "ev"
                        ? tr(lang, "allEvShown")
                        : tr(lang, "allShown")}
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
  lang,
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
    <div className="winner-card winner-card-pulse w-full min-w-0 max-w-full overflow-hidden rounded-[30px] border border-[#b9fb6a]/70 bg-[linear-gradient(180deg,rgba(7,26,18,0.78),rgba(7,26,18,0.66))] p-4 shadow-[0_18px_60px_rgba(0,0,0,.24),inset_0_0_0_1px_rgba(185,251,106,0.32)] sm:p-5">
      {" "}
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 overflow-hidden">
          <div className="inline-flex rounded-full bg-[#b9fb6a]/14 px-3 py-1 text-[10px] font-black uppercase tracking-[.22em] text-[#b9fb6a] ring-1 ring-[#b9fb6a]/25 sm:text-xs sm:tracking-[.24em]">
            {" "}
            {ev ? tr(lang, "bestEvOption") : tr(lang, "bestOption")}
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
                {ev ? tr(lang, "chargingPrice") : tr(lang, "fuelPrice")}
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
                        ? tr(lang, "actualTariff")
                        : tr(lang, "referenceEstimate")}
                    </span>
                  </div>

                  {item.price_source_name && (
                    <div className="mt-2 text-[11px] text-white/45">
                      {tr(lang, "source")}: {item.price_source_name}
                    </div>
                  )}

                  <EvTariffChips item={item} />
                </>
              )}
            </div>
          </div>
          <div className="min-w-0 text-right">
            <div className="text-xs text-white/45">{tr(lang, "drive")}</div>
            <div className="font-black">{formatKm(item.distance_km)}</div>
            <div className="text-xs text-white/45">
              ~{item.estimated_drive_minutes} min
            </div>
          </div>
        </div>

        <div className="mt-4 grid min-w-0 grid-cols-3 gap-2 [&>*]:min-w-0">
          <CostPill
            label={ev ? tr(lang, "energy") : tr(lang, "fuelCost")}
            value={includeFuel ? formatCost(item.fuel_cost) : "—"}
            active={includeFuel}
          />
          <CostPill
            label={tr(lang, "route")}
            value={includePath ? formatCost(item.travel_fuel_cost) : "—"}
            active={includePath}
          />
          <CostPill
            label={tr(lang, "time")}
            value={includeTime ? formatCost(item.time_cost) : "—"}
            active={includeTime}
          />
        </div>

        <div className="mt-3 rounded-2xl border border-[#b9fb6a]/70 bg-[#b9fb6a]/12 p-4 text-white shadow-[0_0_0_1px_rgba(185,251,106,.08),0_18px_46px_rgba(185,251,106,.10)]">
          <div className="text-xs font-black uppercase tracking-[.2em] text-[#b9fb6a]/85">
            {tr(lang, "estimatedTotalCost")}
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
          {tr(lang, "navigation")}
        </a>
        <button
          onClick={shareResult}
          className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-white transition hover:bg-white/[0.08]"
        >
          {shareCopied ? tr(lang, "copied") : tr(lang, "share")}
        </button>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-white/35">
        {ev
          ? item.is_verified
            ? tr(lang, "evVerifiedNote")
            : item.tariff_note || tr(lang, "evEstimatedNote")
          : tr(lang, "fuelMapsNote")}
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
      className="compact-result-card block w-full max-w-full overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.06] px-3 py-4 transition hover:bg-white/[0.09] sm:p-4"
    >
      <div className="grid w-full min-w-0 grid-cols-[54px_minmax(0,1fr)_76px] items-center gap-3 sm:grid-cols-[62px_minmax(0,1fr)_92px]">
        <div className="contents">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xs font-black sm:h-14 sm:w-14 ${brandColor(item.brand)}`}
          >
            {brandShort(item.brand)}
          </div>
          <div className="min-w-0 overflow-hidden">
            <div className="compact-title truncate text-[15px] font-black leading-tight tracking-[-0.02em] text-white sm:text-base">
              {item.name}
            </div>
            <div className="compact-meta mt-1 truncate text-[12px] font-semibold text-white/38">
              {countryLabel(item.country_code)} · {item.address}
            </div>
            <div className="compact-price mt-2 text-[22px] font-black leading-none tracking-[-0.04em] text-[#b9fb6a] sm:text-2xl">
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
          <div className="compact-distance text-[13px] font-black text-white/80 sm:text-sm">
            {formatKm(item.distance_km)}
          </div>
          <div className="text-[11px] text-white/40">
            ~{item.estimated_drive_minutes} min
          </div>
          <div className="mt-1 text-[10px] text-white/40">skupaj</div>
          <div className="compact-total text-[16px] font-black leading-tight text-[#b9fb6a] sm:text-lg">
            {displayTotal < 999999 ? formatMoney(displayTotal) : "—"}
          </div>
        </div>
      </div>
    </a>
  );
}

function ExampleState({ lang }: { lang: Lang }) {
  return (
    <div className="flex h-full min-h-[520px] flex-col justify-center">
      <div className="text-xs font-black uppercase tracking-[.28em] text-[#b9fb6a]">
        {tr(lang, "automaticCalc")}
      </div>
      <h2 className="mt-3 max-w-xl text-4xl font-black leading-tight tracking-tight">
        {tr(lang, "allowLocationTitle")}
      </h2>
      <div className="mt-7 space-y-3">
        <div className="rounded-3xl bg-white/[0.07] p-4">
          <div className="text-sm text-white/45">1. {tr(lang, "location")}</div>
          <div className="mt-1 text-2xl font-black text-[#b9fb6a]">
            {tr(lang, "closestRoutes")}
          </div>
        </div>
        <div className="rounded-3xl bg-white/[0.07] p-4">
          <div className="text-sm text-white/45">
            2. {tr(lang, "parameters")}
          </div>
          <div className="mt-1 text-2xl font-black text-[#b9fb6a]">
            {tr(lang, "paramsText")}
          </div>
        </div>
        <div className="rounded-3xl bg-[#b9fb6a] p-4 text-[#071a12]">
          <div className="text-sm opacity-70">3. {tr(lang, "result")}</div>
          <div className="mt-1 text-2xl font-black">
            {tr(lang, "resultText")}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingState({ lang, status }: { lang: Lang; status: SearchStatus }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.06] p-5">
      <div className="text-sm font-semibold text-white/55">
        {status === "location"
          ? tr(lang, "getLocation")
          : tr(lang, "calcRoutes")}
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
      className={`toggle-info ${active ? "is-active" : "is-inactive"} min-w-0 overflow-hidden rounded-2xl border p-2.5 text-left transition sm:p-3 ${active ? "border-[#b9fb6a]/35 bg-[#b9fb6a]/12" : "border-white/10 bg-white/[0.04] opacity-55"}`}
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

function HowItWorks({ lang }: { lang: Lang }) {
  return (
    <section
      id="how-it-works"
      className="mt-5 w-full min-w-0 overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.055] p-5 backdrop-blur-2xl sm:p-7"
    >
      <h2 className="text-3xl font-black tracking-tight">
        {tr(lang, "howWorks")}
      </h2>
      <p className="mt-4 max-w-4xl text-sm leading-relaxed text-white/60 sm:text-base">
        {tr(lang, "howWorksText")}
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <MiniInfo title={tr(lang, "formula")} text={tr(lang, "formulaText")} />
        <MiniInfo title={tr(lang, "radius")} text={tr(lang, "radiusText")} />
        <MiniInfo
          title={tr(lang, "automaticCalc")}
          text={tr(lang, "autoText")}
        />
      </div>
      <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.05] p-4 text-sm leading-relaxed text-white/55">
        <div className="font-black text-white">{tr(lang, "evPriceNotes")}</div>
        <p className="mt-2">{tr(lang, "evPriceNotes1")}</p>
        <p className="mt-2">{tr(lang, "evPriceNotes2")}</p>
      </div>
    </section>
  );
}

function AppFooter({ lang }: { lang: Lang }) {
  return (
    <footer
      id="app-footer"
      className="mt-4 flex w-full flex-col items-center justify-center gap-2 rounded-[28px] border border-white/10 bg-white/[0.045] px-5 py-6 text-center text-xs text-white/45 backdrop-blur-2xl sm:flex-row sm:gap-3"
    >
      <span>
        {tr(lang, "footerCopyright")} · {tr(lang, "footerAuthor")} Gašper Parte
      </span>
      <span className="hidden text-white/25 sm:inline">•</span>
      <a
        href="https://www.linkedin.com/in/gasperparte/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-black text-[#b9fb6a] transition hover:opacity-75"
      >
        {tr(lang, "footerContact")}
      </a>
    </footer>
  );
}

function ModeSwitch({
  lang,
  mode,
  setMode,
}: {
  lang: Lang;
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
        ⛽ {tr(lang, "fuel")}
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
        ⚡ {tr(lang, "evChargers")}
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
  lang,
  value,
  onChange,
}: {
  lang: Lang;
  value: EvChargingMode;
  onChange: (value: EvChargingMode) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-white/50">
        {tr(lang, "evChargers")}
      </span>
      <div className="grid h-[56px] grid-cols-2 rounded-2xl border border-white/10 bg-[#071a12] p-1 sm:h-[64px]">
        <button
          type="button"
          onClick={() => onChange("DC")}
          className={`rounded-xl text-xs font-black transition sm:text-sm ${value === "DC" ? "bg-[#b9fb6a] text-[#071a12]" : "text-white/55"}`}
        >
          ⚡ {lang === "sl" ? "DC hitro" : "DC fast"}
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
  lang,
  checked,
  onChange,
}: {
  lang: Lang;
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
            {lang === "sl"
              ? "Imam EV paket / aplikacijo za ugodnejšo tarifo"
              : "I have an EV package / app with a better tariff"}
          </div>
          <div className="mt-1 text-[11px] font-semibold leading-relaxed text-white/45">
            {lang === "sl"
              ? "Upoštevamo nižje cene z zvezdico samo pri ujemajočih se ponudnikih."
              : "Lower prices marked with an asterisk are used only for matching providers."}
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
  lang,
  label,
  value,
  onChange,
  options,
}: {
  lang: Lang;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
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
            {label in TEXT[lang]
              ? tr(lang, label as keyof typeof TEXT.sl)
              : label}
          </option>
        ))}
      </select>
    </label>
  );
}
