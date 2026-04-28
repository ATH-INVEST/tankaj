# ⛽ Tankaj.si

Pameten način za odločitev: **kje se ti trenutno najbolj splača tankati.**

Tankaj.si ni samo seznam bencinskih servisov.
Je **decision engine**, ki upošteva realne stroške poti in ti predlaga najboljšo izbiro.

---

## 🚀 Kaj rešuje

Večina aplikacij pokaže:

- najcenejšo ceno na liter
- najbližjo črpalko

👉 ampak to pogosto **ni optimalna odločitev**

Tankaj.si izračuna:

- dejanski strošek poti
- porabo vozila
- čas vožnje
- potencialni prihranek

➡️ in poda **najboljšo realno izbiro**

---

## 🧠 Kako deluje

Aplikacija upošteva:

- 📍 tvojo lokacijo
- ⛽ cene goriva
- 🚗 porabo vozila
- 📏 razdaljo (realna pot, ne zračna)
- ⏱ čas vožnje (vrednoten)
- 💸 skupni strošek (gorivo + pot)

Rezultat ni “najcenejša črpalka”, ampak:

👉 **najbolj smiselna odločitev**

---

## 🌍 Trenutna pokritost

- 🇸🇮 Slovenija
- 🇭🇷 Hrvaška
- 🇦🇹 Avstrija
- 🇮🇹 Italija

---

## 🔜 Naslednji koraki

- ⚡ EV polnilnice
- 🇭🇺 Madžarska
- 📊 izboljšan recommendation engine
- ⚡ performance optimizacija

---

## 🧪 Status

**Beta verzija**

- real data
- real routing
- aktivni razvoj
- hitre iteracije

---

## 🛠 Tech stack

- **Next.js (App Router)**
- **React**
- **Supabase (DB + backend)**
- **Vercel (deploy)**
- **Geolocation API**
- **Routing / distance calculations**

---

## ⚙️ Lokalni razvoj

```bash
git clone https://github.com/ATH-INVEST/tankaj.git
cd tankaj
npm install
npm run dev
```

Odpri:

```
http://localhost:3000
```

---

## 🗂 Ključne stvari v projektu

- `app/page.tsx` → glavni UI + logika prikaza rezultatov
- `app/api/*` → API route-i (routing, izračuni, data fetch)
- `lib/` → shared logika
- `supabase/` → baza + struktura

---

## 🎯 Produktni cilj

Aplikacija mora biti:

- 📱 mobile-first
- ⚡ hitra
- 🧼 enostavna
- 💎 premium UI (Stripe / Apple feel)

Uporabnik:

> odpre app → dovoli lokacijo → vidi najboljšo odločitev

---

## 🔥 Ključna razlika

Namesto:

> “Najcenejši dizel: 1.55€”

Dobiš:

> “Tukaj se ti najbolj splača tankati (prihraniš X €)”

---

## 👤 Avtor

**Gašper Parte**

---

## 📄 Licenca

Private project – ATH INVEST d.o.o.

---

👉 https://tankaj.si
