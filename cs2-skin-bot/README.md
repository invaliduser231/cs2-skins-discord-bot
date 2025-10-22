# CS2 Skin Discord Bot

Ein produktionsnaher Discord-Bot zum Suchen von Counter-Strike 2 Skins über mehrere Marktplätze.

## Setup

```bash
npm install
cp .env.example .env
# Fülle die .env mit Token, Client- und optionaler Guild-ID
npm run register
npm run dev
```

## Nutzung

```text
/skin query:"awp printstream" wear:"Factory New" limit:5
```

## Hinweise

- APIs der Provider können Rate-Limits besitzen. Passe bei Bedarf die Werte in `.env` an.
- Der Steam Community Market benötigt den exakten `market_hash_name`. Der Bot generiert hierfür automatisch mehrere Kandidaten.
- Ergebnisse werden zur besseren Performance für kurze Zeit im Speicher gecacht.
