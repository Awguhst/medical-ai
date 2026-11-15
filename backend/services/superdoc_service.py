"""Doctor search on superdoc.bg (public listing pages).

Superdoc has no public API, so this reads the same server-rendered listing
pages a browser would: https://superdoc.bg/lekari/{specialty}/{city}.

Guard rails:

* The request URL is built only from slugs found in Superdoc's own specialty
  and city indexes. Free text from the model is matched against that catalog
  and never placed in a URL, so the tool cannot be steered to another host or
  path.
* Only the specialty, city and sort order are sent. No user text, symptoms or
  identifiers leave the server.
* Responses are cached (catalog 24 h, searches 10 min) to keep traffic low.
* Everything parsed from the page is treated as untrusted text: whitespace is
  collapsed, lengths are capped, and profile links must point at superdoc.bg.
"""

from __future__ import annotations

import asyncio
import difflib
import logging
import re
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Any

import httpx
from bs4 import BeautifulSoup

from config import Settings, get_settings

logger = logging.getLogger("medai.superdoc")

BASE_URL = "https://superdoc.bg"
_HOST = "superdoc.bg"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; medical-chat-prototype/0.1)",
    "Accept": "text/html",
    "Accept-Language": "bg",
}
_SLUG_RE = re.compile(r"^[a-z0-9-]{2,60}$")
_PROFILE_RE = re.compile(r"^https://superdoc\.bg/lekar/[a-z0-9-]{2,120}$")
_SORT_PARAM = {"popular": "reviews", "rating": "rating", "earliest": "earliest"}

_CATALOG_TTL = 24 * 3600
_SEARCH_TTL = 600
_MAX_RESULTS = 8

# Everyday Bulgarian wording -> the specialty name Superdoc uses.
_SPECIALTY_SYNONYMS = {
    "дентист": "стоматолог",
    "очен": "офталмолог",
    "кожен лекар": "дерматолог",
    "кожен": "дерматолог",
    "ушен лекар": "унг",
    "уши нос гърло": "унг",
    "оториноларинголог": "унг",
    "бъбречен лекар": "нефролог",
    "детски лекар": "педиатър",
    "гинеколог": "акушер гинеколог",
    "сърдечен лекар": "кардиолог",
    "белодробен лекар": "пулмолог",
    "пневмолог": "пулмолог",
    "джипи": "общопрактикуващ лекар",
    "личен лекар": "общопрактикуващ лекар",
    "опл": "общопрактикуващ лекар",
    "стомашен лекар": "гастроентеролог",
    "нервен лекар": "невролог",
}


class SuperdocUnavailable(Exception):
    """Superdoc could not be reached or returned something unusable."""


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFC", text or "").lower()
    text = re.sub(r"\b(гр|град|с|село)\.?\s+", " ", text)
    text = re.sub(r"[^\w]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def _clean(text: str | None, limit: int = 120) -> str:
    return re.sub(r"\s+", " ", text or "").strip()[:limit]


@dataclass
class Catalog:
    specialties: dict[str, str] = field(default_factory=dict)  # slug -> display name
    cities: dict[str, str] = field(default_factory=dict)
    loaded_at: float = 0.0


def match_option(query: str, options: dict[str, str], synonyms: dict[str, str] | None = None) -> str | None:
    """Return the slug whose name best matches the query, or None."""
    q = _norm(query)
    if not q:
        return None
    if synonyms and q in synonyms:
        q = _norm(synonyms[q])
    if q in options and _SLUG_RE.match(q):  # an exact slug
        return q

    # "Пулмолог (Белодробни болести)" is findable as the full name, as
    # "пулмолог" and as "белодробни болести".
    aliases: list[tuple[str, str]] = []  # (normalised alias, slug)
    for slug, name in options.items():
        outside = re.sub(r"\(.*?\)", " ", name)
        inside = " ".join(re.findall(r"\((.*?)\)", name))
        for alias in {_norm(name), _norm(outside), _norm(inside)}:
            if alias:
                aliases.append((alias, slug))

    def unique(slugs: list[str]) -> str | None:
        distinct = set(slugs)
        return distinct.pop() if len(distinct) == 1 else None

    exact = unique([s for a, s in aliases if a == q])
    if exact:
        return exact
    # "кардио" -> "кардиолог"
    if len(q) >= 4:
        hit = unique([s for a, s in aliases if a.startswith(q) or q.startswith(a + " ")])
        if hit:
            return hit
    # "кардиолози" / "кардиология" -> "кардиолог"
    if len(q) >= 6:
        stem = q[: max(4, len(q) - 3)]
        hit = unique([s for a, s in aliases if a.startswith(stem) and " " not in a])
        if hit:
            return hit
    close = difflib.get_close_matches(q, [a for a, _ in aliases], n=1, cutoff=0.82)
    if close:
        return unique([s for a, s in aliases if a == close[0]])
    return None


def parse_catalog_links(html: str, kind: str) -> dict[str, str]:
    """Extract {slug: name} from the specialty or city index page."""
    pattern = r"^https://superdoc\.bg/lekari/grad/([a-z0-9-]+)$" if kind == "city" else (
        r"^https://superdoc\.bg/lekari/([a-z0-9-]+)$"
    )
    found: dict[str, str] = {}
    for link in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        m = re.match(pattern, link["href"])
        name = _clean(link.get_text(), 60)
        if m and name and m.group(1) != "grad" and _SLUG_RE.match(m.group(1)):
            found.setdefault(m.group(1), name)
    return found


def parse_listing(html: str, limit: int = _MAX_RESULTS) -> list[dict[str, Any]]:
    """Extract doctor cards from a listing page."""
    doctors: list[dict[str, Any]] = []
    soup = BeautifulSoup(html, "html.parser")
    for card in soup.select("article.search-result"):
        link = card.select_one("a.search-result-link[href]") or card.select_one("a.btn-doctor-book[href]")
        name = card.select_one("h3")
        if not link or not name or not _PROFILE_RE.match(link["href"]):
            continue

        rating = None
        reviews = None
        for small in card.select("small"):
            text = _clean(small.get_text(), 40)
            if rating is None and re.fullmatch(r"[0-5](?:[.,]\d)?", text):
                rating = float(text.replace(",", "."))
            m = re.search(r"(\d[\d\s]*)\s*оценк", text)
            if m:
                reviews = int(re.sub(r"\s", "", m.group(1)))

        slot = card.select_one(".next-appointment span")
        specialties = card.select_one(".doctor-specialties")
        location = card.select_one(".doctor-location")
        badges = [_clean(chip.get_text(), 40) for chip in card.select(".doctor-badges .chip")]

        doctors.append(
            {
                "name": _clean(name.get_text(), 90),
                "specialties": _clean(specialties.get_text() if specialties else "", 120),
                "location": _clean(location.get_text() if location else "", 60),
                "rating": rating,
                "reviews_count": reviews,
                "next_available": _clean(slot.get_text() if slot else "", 40) or None,
                "badges": [b for b in badges if b][:4],
                "sponsored": "Спонсориран профил" in card.get_text(),
                "profile_url": link["href"],
            }
        )
        if len(doctors) >= limit:
            break
    return doctors


class SuperdocService:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._catalog = Catalog()
        self._catalog_lock = asyncio.Lock()
        self._search_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    async def _get(self, path: str, params: dict[str, str] | None = None) -> str:
        try:
            async with httpx.AsyncClient(
                headers=_HEADERS, timeout=self._settings.superdoc_timeout_seconds, follow_redirects=True
            ) as client:
                response = await client.get(BASE_URL + path, params=params)
        except httpx.HTTPError as exc:
            raise SuperdocUnavailable(type(exc).__name__) from exc
        if response.url.host != _HOST:  # never accept an off-site redirect
            raise SuperdocUnavailable("unexpected redirect")
        if response.status_code == 404:
            return ""
        if response.status_code != 200:
            raise SuperdocUnavailable(f"HTTP {response.status_code}")
        return response.text

    async def catalog(self) -> Catalog:
        async with self._catalog_lock:
            fresh = time.time() - self._catalog.loaded_at < _CATALOG_TTL
            if fresh and self._catalog.specialties:
                return self._catalog
            spec_html, city_html = await asyncio.gather(self._get("/spetsialnost"), self._get("/grad"))
            specialties = parse_catalog_links(spec_html, "specialty")
            cities = parse_catalog_links(city_html, "city")
            if not specialties or not cities:
                raise SuperdocUnavailable("catalog could not be parsed")
            self._catalog = Catalog(specialties, cities, time.time())
            logger.info("superdoc catalog loaded: %d specialties, %d cities", len(specialties), len(cities))
            return self._catalog

    async def search(self, specialty: str, city: str | None, sort: str) -> dict[str, Any]:
        """Return a structured result. Never raises for 'not found' cases."""
        try:
            catalog = await self.catalog()
        except SuperdocUnavailable as exc:
            logger.warning("superdoc catalog unavailable: %s", exc)
            return {"status": "source_unavailable", "message": "Superdoc could not be reached."}

        spec_slug = match_option(specialty, catalog.specialties, _SPECIALTY_SYNONYMS)
        if spec_slug is None:
            return {
                "status": "unknown_specialty",
                "message": "No Superdoc specialty matches this text. Retry with one of available_specialties.",
                "available_specialties": sorted(catalog.specialties.values()),
            }

        city_slug = None
        if city and city.strip():
            city_slug = match_option(city, catalog.cities)
            if city_slug is None:
                return {
                    "status": "unknown_city",
                    "message": (
                        "This town is not listed on Superdoc. Retry with one of available_cities "
                        "(e.g. the nearest larger town) or with city set to null for all of Bulgaria."
                    ),
                    "specialty": catalog.specialties[spec_slug],
                    "available_cities": sorted(catalog.cities.values()),
                }

        path = f"/lekari/{spec_slug}" + (f"/{city_slug}" if city_slug else "")
        params = {"sort": _SORT_PARAM[sort]} if sort != "popular" else None
        search_url = BASE_URL + path + (f"?sort={_SORT_PARAM[sort]}" if params else "")
        query = {
            "specialty": catalog.specialties[spec_slug],
            "city": catalog.cities[city_slug] if city_slug else None,
            "sort": sort,
        }

        cached = self._search_cache.get(search_url)
        if cached and time.time() - cached[0] < _SEARCH_TTL:
            doctors = cached[1]
        else:
            try:
                html = await self._get(path, params)
            except SuperdocUnavailable as exc:
                logger.warning("superdoc search unavailable: %s", exc)
                return {
                    "status": "source_unavailable",
                    "message": "Superdoc could not be reached.",
                    "query": query,
                    "search_url": search_url,
                }
            doctors = parse_listing(html)
            if len(self._search_cache) > 200:
                self._search_cache.clear()
            self._search_cache[search_url] = (time.time(), doctors)

        base = {
            "source": "superdoc.bg",
            "query": query,
            "search_url": search_url,
            "retrieved_at": time.strftime("%Y-%m-%d %H:%M", time.localtime()),
        }
        if not doctors:
            return {
                "status": "no_results",
                "message": "Superdoc lists no doctors for this specialty and location.",
                **base,
                "doctors": [],
            }
        return {
            "status": "success",
            **base,
            "result_count": len(doctors),
            "doctors": doctors,
            "notes": [
                "This is the first page of Superdoc's public listing, not a complete list.",
                "Entries with sponsored=true are paid placements on Superdoc.",
                "Ratings and review counts are Superdoc user ratings, not a measure of clinical quality.",
                "next_available is the earliest slot shown when the page was read and may already be taken.",
                "MedAI has no relationship with Superdoc or these doctors and does not endorse any of them.",
                "Prices, NHIF (НЗОК) coverage and exact addresses must be checked on the doctor's Superdoc profile.",
            ],
        }


_service: SuperdocService | None = None


def get_superdoc_service() -> SuperdocService:
    global _service
    if _service is None:
        _service = SuperdocService(get_settings())
    return _service
