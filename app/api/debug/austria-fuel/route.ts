import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type AustriaFuelType = "DIE" | "SUP" | "GAS";

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

type NormalizedAustriaResult = {
  location_id: string;
  name: string;
  brand: string | null;
  address: string | null;
  city: string | null;
  country_code: "AT";
  lat: number;
  lng: number;
  distance_km: number;
  estimated_drive_minutes: number;
  fuel_type: string;
  price: number;
  fuel_cost: number;
  travel_fuel_cost: number;
  time_cost: number;
  effective_total_cost: number;
  route_source: "air";
  source: "e-control.at";
};

function mapFuelType(input: string | null): AustriaFuelType {
  const value = input?.toLowerCase();

  if (
    value === "bencin" ||
    value === "petrol" ||
    value === "95" ||
    value === "sup"
  ) {
    return "SUP";
  }

  if (value === "cng" || value === "gas") {
    return "GAS";
  }

  return "DIE";
}

function normalizeFuelType(fuel: AustriaFuelType): string {
  if (fuel === "DIE") return "diesel";
  if (fuel === "SUP") return "bencin95";
  return "cng";
}

function normalizeBrand(name: string): string | null {
  const upper = name.toUpperCase();

  if (upper.includes("OMV")) return "OMV";
  if (upper.includes("SHELL")) return "Shell";
  if (upper.includes("JET")) return "JET";
  if (upper.includes("AVIA")) return "AVIA";
  if (upper.includes("ENI") || upper.includes("AGIP")) return "Eni";
  if (upper.includes("BP")) return "BP";
  if (upper.includes("TURMÖL") || upper.includes("TURMOEL")) return "Turmöl";

  return null;
}

function getPrice(
  station: AustriaStation,
  fuel: AustriaFuelType,
): number | null {
  const prices = station.prices ?? [];
  const match = prices.find((price) => price.fuelType === fuel);

  if (typeof match?.amount === "number") {
    return match.amount;
  }

  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const userLat = Number(searchParams.get("lat"));
  const userLng = Number(searchParams.get("lng"));
  const fuel = mapFuelType(searchParams.get("fuel"));

  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
    return NextResponse.json(
      { error: "Missing or invalid lat/lng" },
      { status: 400 },
    );
  }

  const url = new URL(
    "https://api.e-control.at/sprit/1.0/search/gas-stations/by-address",
  );

  url.searchParams.set("latitude", String(userLat));
  url.searchParams.set("longitude", String(userLng));
  url.searchParams.set("fuelType", fuel);
  url.searchParams.set("includeClosed", "false");

  const res = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text();

  if (!res.ok) {
    return NextResponse.json(
      {
        error: "Austria API error",
        status: res.status,
        body: text,
        url: url.toString(),
      },
      { status: 502 },
    );
  }

  let raw: AustriaStation[];

  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON from Austria API",
        body: text.slice(0, 500),
      },
      { status: 502 },
    );
  }

  const avgConsumption = 7;
  const tankLiters = 50;
  const hourlyTimeValue = 12;
  const averageSpeedKmh = 60;

  const normalized: NormalizedAustriaResult[] = raw
    .map((station): NormalizedAustriaResult | null => {
      const price = getPrice(station, fuel);

      if (price === null) return null;

      const stationLat = station.location?.latitude;
      const stationLng = station.location?.longitude;

      if (typeof stationLat !== "number" || typeof stationLng !== "number") {
        return null;
      }

      const airDistanceKm = haversineKm(
        userLat,
        userLng,
        stationLat,
        stationLng,
      );

      // ZA ZDAJ fallback
      const distanceKm = airDistanceKm;

      const fuelCost = tankLiters * price;
      const travelFuelCost = distanceKm * (avgConsumption / 100) * price;

      const estimatedDriveMinutes = Math.max(
        1,
        Math.round((distanceKm / averageSpeedKmh) * 60),
      );

      const timeCost = (estimatedDriveMinutes / 60) * hourlyTimeValue;
      const effectiveTotalCost = fuelCost + travelFuelCost + timeCost;

      return {
        location_id: `AT_${station.id}`,
        name: station.name,
        brand: normalizeBrand(station.name),
        address: station.location?.address ?? null,
        city: station.location?.city ?? null,
        country_code: "AT",
        lat: stationLat,
        lng: stationLng,
        distance_km: round2(distanceKm),
        estimated_drive_minutes: estimatedDriveMinutes,
        fuel_type: normalizeFuelType(fuel),
        price,
        fuel_cost: round2(fuelCost),
        travel_fuel_cost: round2(travelFuelCost),
        time_cost: round2(timeCost),
        effective_total_cost: round2(effectiveTotalCost),
        route_source: "air",
        source: "e-control.at",
      };
    })
    .filter((item): item is NormalizedAustriaResult => item !== null);

  return NextResponse.json({
    source: "e-control.at",
    country: "AT",
    fuel,
    count: normalized.length,
    results: normalized,
  });
}
