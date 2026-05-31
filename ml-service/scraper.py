"""
Scraper for Engocha.com rental listings in Addis Ababa.
Collects property data to seed the price prediction model.

Usage:
    python scraper.py
    python scraper.py --pages 3   # scrape more pages
"""

import argparse
import json
import re
import time
import os
import logging
from typing import Optional
import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

BASE_URL = "https://engocha.com"
INDEX_URL = f"{BASE_URL}/apartments-houses-for-rent?city=Addis+Ababa"
USD_TO_ETB = 130  # approximate exchange rate

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

ADDIS_SUBCITIES = {
    "bole", "kirkos", "arada", "lideta", "addis ketema",
    "akaky kaliti", "kolfe keranio", "gullele", "nifas silk-lafto", "yeka",
    "nifas silk lafto", "kolfe", "akaki kality", "akaki kaliti",
}

SUBCITY_CANONICAL = {
    "nifas silk lafto": "nifas silk-lafto",
    "akaki kality": "akaky kaliti",
    "akaki kaliti": "akaky kaliti",
    "kolfe": "kolfe keranio",
}


def get_soup(url: str, retries: int = 3) -> Optional[BeautifulSoup]:
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=20)
            resp.raise_for_status()
            return BeautifulSoup(resp.text, "lxml")
        except Exception as e:
            log.warning(f"Attempt {attempt + 1} failed for {url}: {e}")
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
    return None


def parse_price_etb(raw: str) -> Optional[float]:
    if not raw:
        return None
    raw = raw.strip()
    nums = [n for n in re.findall(r"[\d,]+(?:\.\d+)?", raw) if n.replace(",", "")]
    if not nums:
        return None
    amount = float(nums[0].replace(",", ""))
    if amount == 0:
        return None
    if "USD" in raw.upper() or "$" in raw:
        amount *= USD_TO_ETB
    # Filter out clearly wrong values (sale prices, not rent)
    if amount > 2_000_000:
        return None
    if amount < 3_000:
        return None
    return amount


def parse_area(raw: str) -> Optional[float]:
    if not raw:
        return None
    raw = raw.upper().replace("M²", "").replace("M2", "").strip()
    if "ABOVE 1000" in raw:
        return 1200.0
    if "ABOVE" in raw:
        nums = re.findall(r"\d+", raw)
        return float(nums[0]) * 1.2 if nums else None
    if "-" in raw:
        parts = re.findall(r"\d+", raw)
        if len(parts) >= 2:
            return (float(parts[0]) + float(parts[1])) / 2.0
    nums = re.findall(r"\d+(?:\.\d+)?", raw)
    return float(nums[0]) if nums else None


def parse_bedrooms(raw: str) -> Optional[int]:
    if not raw:
        return None
    raw = str(raw).upper()
    if "ABOVE 20" in raw or "20+" in raw:
        return 22
    nums = re.findall(r"\d+", raw)
    return int(nums[0]) if nums else None


def normalize_subcity(raw: str) -> str:
    key = raw.strip().lower()
    return SUBCITY_CANONICAL.get(key, key)


def extract_subcity_from_text(text: str) -> Optional[str]:
    text_lower = text.lower()
    for sc in sorted(ADDIS_SUBCITIES, key=len, reverse=True):
        if sc in text_lower:
            return normalize_subcity(sc)
    return None


def scrape_listing_detail(url: str) -> Optional[dict]:
    """Fetch an individual listing page and extract all fields."""
    # Skip non-engocha URLs entirely
    if not url.startswith(BASE_URL):
        return None

    soup = get_soup(url)
    if not soup:
        return None

    listing: dict = {"source_url": url}

    # --- Strategy 1: Parse the structured meta span that engocha always includes ---
    # Format: "Title - Condition: X, House Type: X, Bedrooms: N, Area (m²): X, Price: N ETB"
    meta_span = soup.find("span", string=re.compile(r"Price\s*:", re.I))
    if meta_span:
        span_text = meta_span.get_text(" ", strip=True)
        # Extract price
        price_match = re.search(r"Price\s*:\s*([\d,]+(?:\.\d+)?)\s*(ETB|USD|\$)?", span_text, re.I)
        if price_match:
            val = price_match.group(1).replace(",", "")
            currency_hint = f"{val} {price_match.group(2) or 'ETB'}"
            listing["price_etb"] = parse_price_etb(currency_hint)

        # Extract area from "Area (m²): X"
        area_match = re.search(r"Area\s*\(m[²2]\)\s*:\s*([^,]+)", span_text, re.I)
        if area_match:
            listing["area_m2"] = parse_area(area_match.group(1).strip())

        # Extract bedrooms
        bed_match = re.search(r"Bedrooms?\s*:\s*(\S+)", span_text, re.I)
        if bed_match:
            listing["bedrooms"] = parse_bedrooms(bed_match.group(1))

        # Condition / furnishing
        cond_match = re.search(r"Condition\s*:\s*([^,]+)", span_text, re.I)
        if cond_match:
            cond = cond_match.group(1).strip().lower()
            if "unfurnish" in cond:
                listing["furnishing"] = "unfurnished"
            elif "semi" in cond:
                listing["furnishing"] = "semi_furnished"
            elif "furnish" in cond:
                listing["furnishing"] = "furnished"

        # House type
        type_match = re.search(r"House Type\s*:\s*([^,]+)", span_text, re.I)
        if type_match:
            ht = type_match.group(1).strip().lower()
            if "apartment" in ht:
                listing["property_type"] = "apartment"
            elif "villa" in ht:
                listing["property_type"] = "villa"
            elif "condominium" in ht or "condo" in ht:
                listing["property_type"] = "condominium"
            else:
                listing["property_type"] = "house"

    # --- Strategy 2: Price from h4 tag (fallback) ---
    if "price_etb" not in listing:
        for tag in soup.find_all(["h4", "h3", "strong"]):
            text = tag.get_text(strip=True)
            if "ETB" in text or "USD" in text:
                price = parse_price_etb(text)
                if price:
                    listing["price_etb"] = price
                    break

    # --- Strategy 3: Area from description text ---
    if "area_m2" not in listing:
        full_text = soup.get_text(" ", strip=True)
        # Match patterns like "350sqm", "Area 1000m²", "1200 m²", "Area (m²)Above 1000M²"
        for pattern in [
            r"Area\s*\(m[²2]\)\s*([^<\n,]+)",
            r"(\d+(?:\.\d+)?)\s*(?:sqm|m²|m2|square meter)",
            r"Area\s+(\d+(?:\.\d+)?)\s*m",
        ]:
            m = re.search(pattern, full_text, re.I)
            if m:
                area = parse_area(m.group(1))
                if area and area > 0:
                    listing["area_m2"] = area
                    break

    # --- Sub-city from page text ---
    full_text = soup.get_text(" ", strip=True)
    sc = extract_subcity_from_text(full_text)
    if sc:
        listing["sub_city"] = sc

    # --- Bathrooms from description ---
    if "bathrooms" not in listing:
        bath_match = re.search(r"(\d+)\s*(?:&\s*½\s*)?bath\s*room", full_text, re.I)
        if bath_match:
            listing["bathrooms"] = int(bath_match.group(1))

    # --- Amenities ---
    amenity_keywords = {
        "parking": "parking",
        "generator": "generator",
        "security": "security",
        "internet": "internet",
        "gym": "gym",
        "elevator": "elevator",
        "garden": "garden",
        "swimming pool": "swimming_pool",
        "water tanker": "water_tanker",
        "ceramic": "ceramic_floor",
    }
    amenities = []
    full_lower = full_text.lower()
    for kw, label in amenity_keywords.items():
        if kw in full_lower:
            amenities.append(label)
    listing["amenities"] = amenities

    return listing


def scrape_index_page(url: str) -> list[str]:
    """Get all listing URLs from an index page."""
    soup = get_soup(url)
    if not soup:
        return []

    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        # Build the full URL first
        full = href if href.startswith("http") else f"{BASE_URL}{href}"
        # Only keep actual engocha listing pages (strip query/UTM params)
        clean = full.split("?")[0]
        if clean.startswith(f"{BASE_URL}/classifieds/") and clean not in links:
            links.append(clean)
    return links


def scrape_all(max_pages: int = 5) -> list[dict]:
    listings = []
    all_urls = set()

    for page in range(1, max_pages + 1):
        page_url = f"{INDEX_URL}&page={page}" if page > 1 else INDEX_URL
        log.info(f"Fetching index page {page}: {page_url}")
        urls = scrape_index_page(page_url)
        if not urls:
            log.info(f"No listings found on page {page}, stopping.")
            break
        new_urls = [u for u in urls if u not in all_urls]
        all_urls.update(new_urls)
        log.info(f"Found {len(new_urls)} new listings on page {page}")

        for i, url in enumerate(new_urls):
            log.info(f"  Scraping listing {i + 1}/{len(new_urls)}: {url}")
            detail = scrape_listing_detail(url)
            if detail and detail.get("price_etb") and detail.get("area_m2"):
                listings.append(detail)
                log.info(
                    f"  Saved: price={detail['price_etb']:,.0f} ETB  "
                    f"area={detail['area_m2']}m²  "
                    f"beds={detail.get('bedrooms')}  "
                    f"sub_city={detail.get('sub_city')}"
                )
            else:
                log.warning(f"  Skipped (missing price or area): {url}")
            time.sleep(1.5)  # polite delay

        time.sleep(2)

    return listings


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape Engocha rental listings")
    parser.add_argument("--pages", type=int, default=5, help="Max pages to scrape")
    parser.add_argument(
        "--output",
        type=str,
        default="data/scraped_listings.json",
        help="Output JSON file",
    )
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.output), exist_ok=True)

    log.info(f"Starting scrape (max {args.pages} pages)...")
    results = scrape_all(max_pages=args.pages)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    log.info(f"Done. Collected {len(results)} usable listings → {args.output}")
