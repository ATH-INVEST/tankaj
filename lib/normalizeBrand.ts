export function normalizeBrandKey(input: string | null | undefined): string {
  return String(input || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

const BRAND_ALIASES: Record<string, string> = {
  AGIP: "ENI",
  ENI: "ENI",

  TURMOL: "TURMOEL",
  TURMOEL: "TURMOEL",

  TOTAL: "TOTALENERGIES",
  TOTALENERGIES: "TOTALENERGIES",

  ITALIANAPETROLI: "IP",

  DISCOUNT: "DISKONT",

  PETROL: "PETROL",
  MOL: "MOL",
  SHELL: "SHELL",
  OMV: "OMV",
  BP: "BP",
  HOFER: "HOFER",
  DISKONT: "DISKONT",
  GENOL: "GENOL",
  LAGERHAUS: "LAGERHAUS",
  JET: "JET",
  AVIA: "AVIA",
  MAXEN: "MAXEN",
  INA: "INA",
  TIFON: "TIFON",
  CRODUX: "CRODUX",
  Q8: "Q8",
  IP: "IP",
  TAMOIL: "TAMOIL",
  ESSO: "ESSO",
  TESLA: "TESLA",
  LIDL: "LIDL",
  ARAL: "ARAL",
  HEM: "HEM",
  STAR: "STAR",
  ORLEN: "ORLEN",
};

export function getCanonicalBrand(
  input: string | null | undefined,
): string | null {
  const key = normalizeBrandKey(input);
  if (!key) return null;

  if (BRAND_ALIASES[key]) return BRAND_ALIASES[key];

  const aliases = Object.keys(BRAND_ALIASES).sort(
    (a, b) => b.length - a.length,
  );
  const match = aliases.find((alias) => key.includes(alias));

  return match ? BRAND_ALIASES[match] : null;
}
