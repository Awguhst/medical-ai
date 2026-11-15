"""Medication reference lookup on framar.bg (public pages).

Framar has no public API, so this reads the same server-rendered pages a
browser would. Three kinds of page are used:

* search            https://zdrave.framar.bg/търсите/{name}
* product leaflet   https://apteka.framar.bg/{id}/{slug}
* active ingredient https://medpedia.framar.bg/фармакологични-групи/{atc}/{slug}
* interactions      https://vzaimodeistvie.framar.bg/{1|50}-{id}-...

Guard rails:

* Only the medication name is sent to Framar, and only as a search term. It
  is reduced to letters, digits and a few separators first.
* Every URL that is fetched is either the search URL built here or a link
  found on a Framar page that matches one of the patterns below. Redirects
  that leave framar.bg are rejected. robots.txt allows these paths.
* Traffic is kept low: a few requests per lookup, at most four at a time,
  and parsed pages are cached in memory (pages 24 h, searches 1 h).
* Everything parsed is untrusted text: whitespace is collapsed, lengths are
  capped, links must match the Framar patterns.
* Framar's content is copyrighted. The tool returns capped extracts for the
  model to summarise with a link to the source; it does not mirror pages and
  nothing is written to disk.
* "No interaction listed" is never reported as "safe".
"""

from __future__ import annotations

import asyncio
import difflib
import itertools
import logging
import re
import time
import unicodedata
from typing import Any, Callable
from urllib.parse import quote, unquote

import httpx
from bs4 import BeautifulSoup, Tag

from config import Settings, get_settings

logger = logging.getLogger("medai.framar")

SEARCH_URL = "https://zdrave.framar.bg/търсите/"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; medical-chat-prototype/0.1)",
    "Accept": "text/html",
    "Accept-Language": "bg",
}

_SLUG = r"[^/?#\s\"'<>\\]{1,220}"
_PRODUCT_RE = re.compile(rf"^https://apteka\.framar\.bg/(\d{{6,10}})/{_SLUG}$")
_SUBSTANCE_RE = re.compile(
    rf"^https://medpedia\.framar\.bg/фармакологични-групи/([a-z]\d{{2}}[a-z]{{2}}\d{{2}})/{_SLUG}$"
)
_INTERACTION_RE = re.compile(rf"^https://vzaimodeistvie\.framar\.bg/(?:1|50)-\d+{_SLUG}$")
_ATC_RE = re.compile(r"\b([A-Z]\d{2}[A-Z]{2}\d{2})\b")

_PAGE_TTL = 24 * 3600
_SEARCH_TTL = 3600
_CACHE_MAX = 400
MAX_MEDICATIONS = 4
_TEXT_BUDGET = 16_000  # characters of extracted text per tool call
_PER_MEDICATION_MAX = 7_000
_PAIR_TEXT_MAX = 1_800

_SEVERITY = {"3": "major", "2": "moderate", "1": "minor"}

# Words that end the brand part of a product title ("НУРОФЕН ФОРТЕ таблетки 400 мг").
_FORM_WORDS = {
    "таблетки", "таблетка", "табл", "капсули", "капсула", "капс", "сироп", "суспензия", "разтвор",
    "саше", "гел", "крем", "унгвент", "маз", "спрей", "капки", "ампули", "амп", "прах", "гранули",
    "супозитории", "свещички", "пастили", "пластир", "филмирани", "обвити", "ефервесцентни",
    "перорална", "перорален", "инжекционен", "инфузионен", "дъвчащи", "меки", "твърди", "стомашно",
    "мг", "мл", "г", "mg", "ml",
}

# Leaflet section headings: "2. Какво трябва да знаете, преди да ..."
_SECTION_HEAD_RE = re.compile(
    r"^([1-6])\s*[.)]\s*(Какво|Преди|Как |Как$|Възможни|Съхранение|Съдържание|Допълнителна)", re.IGNORECASE
)
_OTHER_MEDICINES_RE = re.compile(r"други\s+лекарства|прием(а|ът)? на други лекарства", re.IGNORECASE)

_SUBSTANCE_LABELS = {
    "показания": "indications",
    "противопоказания": "contraindications",
    "нежелани лекарствени реакции": "side_effects",
    "лекарствени взаимодействия": "interactions",
    "дозов режим": "dosage",
    "достъп до пациента": "access",
}


class FramarUnavailable(Exception):
    """Framar could not be reached or returned something unusable."""


# --- text helpers ------------------------------------------------------------


def _clean(text: str | None, limit: int | None = None) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text[:limit] if limit else text


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFC", text or "").lower()
    text = re.sub(r"[^\w]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def sanitize_query(name: str) -> str:
    """Reduce a medication name to something safe to place in the search URL."""
    name = unicodedata.normalize("NFC", name or "")
    name = re.sub(r"[^\w\s+\-.]", " ", name, flags=re.UNICODE).replace("_", " ")
    name = re.sub(r"\.{2,}", " ", name)
    return re.sub(r"\s+", " ", name).strip(" .-")[:60]


_TRANSLIT_MULTI = [
    ("sch", "ш"), ("sh", "ш"), ("ch", "х"), ("ph", "ф"), ("th", "т"), ("zh", "ж"), ("ts", "ц"),
    ("ya", "я"), ("yu", "ю"), ("ae", "е"), ("oe", "е"), ("qu", "кв"), ("ck", "к"),
]
_TRANSLIT_SINGLE = {
    "a": "а", "b": "б", "d": "д", "e": "е", "f": "ф", "g": "г", "h": "х", "i": "и", "j": "дж",
    "k": "к", "l": "л", "m": "м", "n": "н", "o": "о", "p": "п", "q": "к", "r": "р", "s": "с",
    "t": "т", "u": "у", "v": "в", "w": "в", "x": "кс", "y": "и", "z": "з",
}


def transliterate(text: str) -> str:
    """Rough Latin -> Cyrillic for drug names ('ibuprofen' -> 'ибупрофен')."""
    text = text.lower()
    if not re.search(r"[a-z]", text):
        return text
    for latin, cyr in _TRANSLIT_MULTI:
        text = text.replace(latin, cyr)
    out = []
    for i, ch in enumerate(text):
        if ch == "c":
            nxt = text[i + 1] if i + 1 < len(text) else ""
            out.append("ц" if nxt in "eiy" else "к")
        else:
            out.append(_TRANSLIT_SINGLE.get(ch, ch))
    return "".join(out)


def _collapse(text: str) -> str:
    """Drop doubled letters so 'амоксициллин' compares equal to 'амоксицилин'."""
    return re.sub(r"(.)\1+", r"\1", text)


def _same_name(a: str, b: str) -> bool:
    a, b = _collapse(_norm(a)), _collapse(_norm(b))
    if not a or not b:
        return False
    return a == b or (min(len(a), len(b)) >= 5 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.86)


def _query_forms(query: str) -> list[str]:
    q = _norm(query)
    forms = [q]
    t = _norm(transliterate(q))
    if t and t != q:
        forms.append(t)
    return forms


def _truncate(text: str, limit: int) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    cut = text[:limit]
    stop = max(cut.rfind(". "), cut.rfind("; "), cut.rfind("\n"))
    if stop > limit * 0.6:
        cut = cut[: stop + 1]
    return cut.rstrip() + " […]", True


def _href(tag: Tag) -> str:
    return unquote(str(tag.get("href", ""))).strip()


# --- parsers (pure functions; exercised by the offline tests) ---------------


def parse_search(html: str) -> list[dict[str, str]]:
    """Product and active-ingredient hits from a search result page, in page order."""
    hits: list[dict[str, str]] = []
    seen: set[str] = set()
    for link in BeautifulSoup(html, "html.parser").select("h2.header a[href]"):
        url = _href(link)
        title = _clean(link.get_text(" "), 160)
        if not title or url in seen:
            continue
        if _PRODUCT_RE.match(url):
            hits.append({"kind": "product", "title": title, "url": url})
        else:
            m = _SUBSTANCE_RE.match(url)
            if not m:
                continue
            name = _clean(re.sub(r"^\s*[A-Z]\d{2}[A-Z]{2}\d{2}\s*", "", title), 120)
            hits.append({"kind": "active_ingredient", "title": title, "name": name,
                         "atc": m.group(1).upper(), "url": url})
        seen.add(url)
    return hits


def _brand_rank(title: str, form: str) -> tuple[int, int] | None:
    """How well a product title matches a brand query; lower is better, None = no match."""
    words = _norm(title).split()
    q_words = form.split()
    head = " ".join(words[: len(q_words)])
    if not q_words or not (head == form or _same_name(head, form)):
        return None
    extra = 0  # brand modifiers before the dose form: "ЕКСПРЕС ФОРТЕ"
    for word in words[len(q_words):]:
        if word in _FORM_WORDS or word[0].isdigit():
            break
        extra += 1
    return extra, len(title)


def matching_products(query: str, hits: list[dict[str, str]]) -> list[dict[str, str]]:
    """Product hits whose title starts with the query (a brand or generic name), best first."""
    forms = _query_forms(query)
    ranked = []
    for index, hit in enumerate(h for h in hits if h["kind"] == "product"):
        ranks = [r for r in (_brand_rank(hit["title"], form) for form in forms) if r is not None]
        if ranks:
            ranked.append((min(ranks), index, hit))
    return [hit for _, _, hit in sorted(ranked, key=lambda item: (item[0], item[1]))]


def matching_substances(query: str, hits: list[dict[str, str]]) -> list[dict[str, str]]:
    """Active-ingredient hits named exactly like the query (one substance can have several ATC entries)."""
    forms = _query_forms(query)
    return [
        h for h in hits
        if h["kind"] == "active_ingredient" and any(_same_name(h["name"], form) for form in forms)
    ]


def choose_hit(query: str, hits: list[dict[str, str]]) -> dict[str, str] | None:
    """Pick the search hit that the query most plausibly names."""
    # 1. The query is exactly the name of an active ingredient.
    substances = matching_substances(query, hits)
    if substances:
        return substances[0]
    # 2. The query is a brand: product titles start with it.
    products = matching_products(query, hits)
    if products:
        return products[0]
    # 3. A single-ingredient entry that contains the query as a whole word.
    forms = _query_forms(query)
    for hit in hits:
        if hit["kind"] != "active_ingredient":
            continue
        name = f" {_norm(hit['name'])} "
        if " и " in name or "комбинации" in name:
            continue
        if any(f" {form} " in name for form in forms):
            return hit
    return None


def _blocks(container: Tag) -> list[tuple[str, str]]:
    """(tag, text) for the text-bearing blocks of a container, in order, without duplicates."""
    out: list[tuple[str, str]] = []
    for el in container.find_all(["h2", "h3", "h4", "p", "li", "td"]):
        if el.find(["p", "li", "ul", "ol", "table", "h3", "h4"]):
            own = _clean(" ".join(s for s in el.find_all(string=True, recursive=False)))
            if own:
                out.append((el.name, own))
            continue
        text = _clean(el.get_text(" "))
        if text:
            out.append((el.name, text))
    return out


def _leaflet_sections(blocks: list[tuple[str, str]]) -> dict[int, list[tuple[str, str]]]:
    sections: dict[int, list[tuple[str, str]]] = {}
    current = 0
    for tag, text in blocks:
        m = _SECTION_HEAD_RE.match(text) if len(text) < 170 else None
        if m:
            number = int(m.group(1))
            if number <= current:  # the table of contents came first: start over
                sections = {}
            current = number
            sections[current] = []
            continue
        if current:
            sections[current].append((tag, text))
    return sections


def _render(blocks: list[tuple[str, str]]) -> str:
    lines = []
    for tag, text in blocks:
        if tag in ("h3", "h4"):
            lines.append(f"## {text}")
        elif tag == "li":
            lines.append(f"- {text}")
        else:
            lines.append(text)
    return "\n".join(lines)


def _split_section_two(blocks: list[tuple[str, str]]) -> tuple[list, list, list]:
    """Section 2 -> (contraindications & warnings, other medicines, pregnancy/food/driving)."""
    start = next((i for i, (_, t) in enumerate(blocks) if len(t) < 160 and _OTHER_MEDICINES_RE.search(t)), None)
    if start is None:
        return blocks, [], []
    end = next(
        (i for i in range(start + 1, len(blocks)) if blocks[i][0] in ("h3", "h4") and not
         _OTHER_MEDICINES_RE.search(blocks[i][1])),
        len(blocks),
    )
    return blocks[:start], blocks[start:end], blocks[end:]


def parse_product(html: str, url: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    article = soup.find("article") or soup
    h1 = article.find("h1")
    name = _clean(h1.get_text(" ") if h1 else "", 160)

    ingredients: list[dict[str, str]] = []
    interactions_url = None
    for link in soup.find_all("a", href=True):
        href = _href(link)
        if "apteka.framar.bg/продукти-с-активна-съставка-" in href:
            text = _clean(link.get_text(" "), 140)
            m = _ATC_RE.search(text)
            entry = {"name": _clean(re.sub(r"\(\s*[A-Z]\d{2}[A-Z]{2}\d{2}\s*\)", "", text), 120),
                     "atc": m.group(1) if m else ""}
            if entry["name"] and entry not in ingredients:
                ingredients.append(entry)
        elif interactions_url is None and re.match(r"^https://vzaimodeistvie\.framar\.bg/1-\d+", href) \
                and _INTERACTION_RE.match(href):
            interactions_url = href

    blocks = _blocks(article)
    sections = _leaflet_sections(blocks)
    parts: list[dict[str, Any]] = []
    if sections:
        before, other_meds, rest = _split_section_two(sections.get(2, []))
        composition = sections.get(6, [])
        stop = next((i for i, (_, t) in enumerate(composition) if re.match(r"как изглежда", t, re.I)), len(composition))
        layout = [
            ("what_it_is", "Какво представлява и за какво се използва", sections.get(1, []), 0.06),
            ("contraindications_and_warnings", "Кога да не се приема; предупреждения", before, 0.22),
            ("other_medicines", "Други лекарства (взаимодействия по листовка)", other_meds, 0.16),
            ("pregnancy_food_driving", "Храна, алкохол, бременност, кърмене, шофиране", rest, 0.10),
            ("how_to_take", "Как се приема (дозировка по листовка)", sections.get(3, []), 0.26),
            ("side_effects", "Възможни нежелани реакции", sections.get(4, []), 0.16),
            ("composition", "Състав", composition[:stop], 0.04),
        ]
        parts = [{"topic": t, "title": title, "text": _render(b), "weight": w} for t, title, b, w in layout if b]
    else:
        # No patient leaflet on the page (supplements, devices): keep the description only.
        body = [b for b in blocks if b[1] != name][:40]
        if body:
            parts = [{"topic": "description", "title": "Описание от страницата", "text": _render(body), "weight": 1.0}]

    return {
        "kind": "product",
        "name": name,
        "active_ingredients": ingredients,
        "source_url": url,
        "interactions_url": interactions_url,
        "has_leaflet": bool(sections),
        "parts": parts,
    }


def parse_substance(html: str, url: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    article = soup.find("article") or soup
    h1 = _clean(article.find("h1").get_text(" ") if article.find("h1") else "", 200)
    m = _SUBSTANCE_RE.match(url)
    atc = m.group(1).upper() if m else ""
    title = re.split(r"\|", h1)[0].strip()
    latin = re.search(r"\(([^)]+)\)", title)
    name = _clean(re.sub(r"\([^)]*\)", "", title), 120)

    parts: list[dict[str, Any]] = []
    for p in article.find_all("p"):
        if p.find_parent(class_="comment") or p.find_parent("li"):
            continue
        text = _clean(p.get_text(" "))
        if len(text) < 30 and ":" not in text:
            continue
        label, _, rest = text.partition(":")
        topic = _SUBSTANCE_LABELS.get(_norm(label))
        if topic and rest.strip():
            parts.append({"topic": topic, "title": _clean(label, 60), "text": rest.strip(), "weight": 1.0})
        elif not parts and len(text) > 60 and not _norm(label) in ("фармакодинамика", "фармакокинетика"):
            parts.append({"topic": "description", "title": "Описание", "text": text, "weight": 0.5})

    counts: dict[str, int] = {}
    interactions_url = None
    for li in article.select("li.int"):
        icon = li.find("i")
        level = next((c[-1] for c in (icon.get("class") or []) if c.startswith("force-")), "") if icon else ""
        number = re.search(r"\(\s*(\d+)\s*\)", _clean(li.get_text(" ")))
        if level in _SEVERITY and number:
            counts[_SEVERITY[level]] = int(number.group(1))
    for link in article.find_all("a", href=True):
        href = _href(link)
        if re.match(r"^https://vzaimodeistvie\.framar\.bg/50-\d+", href) and _INTERACTION_RE.match(href):
            interactions_url = href
            break

    return {
        "kind": "active_ingredient",
        "name": name,
        "latin_name": _clean(latin.group(1), 80) if latin else "",
        "active_ingredients": [{"name": name, "atc": atc}],
        "source_url": url,
        "interactions_url": interactions_url,
        "listed_interaction_counts": counts,
        "parts": parts,
    }


def _interaction_items(scope: Tag) -> list[dict[str, str]]:
    items = []
    for li in scope.select("li.int"):
        link = li.find("a", href=True)
        if not link or not _INTERACTION_RE.match(_href(link)):
            continue
        icon = li.find("i")
        level = next((c[-1] for c in (icon.get("class") or []) if c.startswith("force-")), "") if icon else ""
        text = _clean(link.get_text(" "), 160)
        m = re.match(r"^(.*?)\s*-\s*([A-Z]\d{2}[A-Z]{2}\d{2})\s*(?:\((.*?)\))?$", text)
        items.append({
            "name": _clean(m.group(1) if m else text, 120),
            "atc": m.group(2) if m else "",
            "latin_name": _clean(m.group(3), 80) if m and m.group(3) else "",
            "severity": _SEVERITY.get(level, "unspecified"),
            "url": _href(link),
        })
    return items


def parse_interaction_overview(html: str) -> dict[str, Any]:
    """The first interactions page: top entries, food/drink entries, link to the full list."""
    soup = BeautifulSoup(html, "html.parser")
    drugs: list[dict[str, str]] = []
    foods: list[dict[str, str]] = []
    for heading in soup.find_all("h2"):
        text = _norm(heading.get_text(" "))
        target = foods if "храни" in text else drugs if "лекарства" in text else None
        block = heading.find_next_sibling(["ul", "div"])
        if target is not None and block is not None:
            target.extend(_interaction_items(block))
    all_url = None
    for link in soup.find_all("a", href=True):
        if "всички взаимодействия с лекарства" in _norm(link.get_text(" ")) and _INTERACTION_RE.match(_href(link)):
            all_url = _href(link)
            break
    return {"drugs": drugs, "foods": foods, "all_drugs_url": all_url}


def parse_interaction_list(html: str) -> list[dict[str, str]]:
    return _interaction_items(BeautifulSoup(html, "html.parser"))


def parse_interaction_pair(html: str) -> dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    article = soup.find("article") or soup
    important = article.find("p", class_="important")
    statement = _clean(important.get_text(" "), 300) if important else ""
    body = [
        _clean(p.get_text(" "))
        for p in article.find_all("p")
        if p is not important and "important" not in (p.get("class") or [])
    ]
    body = [t for t in body if t and not t.startswith(("Обратно към", "Една от активните съставки"))]
    return {"statement": statement, "text": "\n".join(body)}


def _apply_budget(parts: list[dict[str, Any]], budget: int) -> list[dict[str, Any]]:
    total = sum(p["weight"] for p in parts) or 1.0
    out = []
    spare = 0
    for part in parts:
        limit = int(budget * part["weight"] / total) + spare
        text, truncated = _truncate(part["text"], max(limit, 200))
        spare = max(0, limit - len(text))
        out.append({"topic": part["topic"], "title": part["title"], "text": text, "truncated": truncated})
    return out


# --- service -----------------------------------------------------------------


class FramarService:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._cache: dict[str, tuple[float, Any]] = {}
        self._limit = asyncio.Semaphore(4)

    async def _get(self, url: str) -> str:
        """Fetch one Framar page. Returns '' for 404."""
        if not (url.startswith(SEARCH_URL) or _PRODUCT_RE.match(url) or _SUBSTANCE_RE.match(url)
                or _INTERACTION_RE.match(url)):
            raise FramarUnavailable("refused url")
        try:
            async with self._limit:
                async with httpx.AsyncClient(
                    headers=_HEADERS, timeout=self._settings.framar_timeout_seconds, follow_redirects=True
                ) as client:
                    response = await client.get(url)
        except httpx.HTTPError as exc:
            raise FramarUnavailable(type(exc).__name__) from exc
        host = response.url.host or ""
        if host != "framar.bg" and not host.endswith(".framar.bg"):
            raise FramarUnavailable("unexpected redirect")
        if response.status_code == 404:
            return ""
        if response.status_code != 200:
            raise FramarUnavailable(f"HTTP {response.status_code}")
        return response.text

    async def _page(self, url: str, parser: Callable[[str], Any], ttl: int) -> Any:
        cached = self._cache.get(url)
        if cached and time.time() - cached[0] < ttl:
            return cached[1]
        parsed = parser(await self._get(url))
        if len(self._cache) >= _CACHE_MAX:
            self._cache.clear()
        self._cache[url] = (time.time(), parsed)
        return parsed

    async def _resolve(self, raw_name: str) -> dict[str, Any]:
        """Find one medication and read its page. Never raises."""
        query = sanitize_query(raw_name)
        base: dict[str, Any] = {"query": _clean(raw_name, 60)}
        if len(query) < 2:
            return {**base, "status": "not_found", "message": "The name is empty after cleaning."}
        search_url = SEARCH_URL + quote(query)
        try:
            hits = await self._page(search_url, parse_search, _SEARCH_TTL)
            hit = choose_hit(query, hits)
            if hit is None:
                return {
                    **base,
                    "status": "not_found",
                    "message": (
                        "Framar's search has no product or active ingredient that clearly matches this name. "
                        "Retry with the Bulgarian name of the active ingredient or the exact brand name, "
                        "or pick one of the suggestions."
                    ),
                    "suggestions": [{"title": h["title"], "kind": h["kind"]} for h in hits[:6]],
                }
            if hit["kind"] == "product":
                data = await self._product(hit["url"])
            else:
                data = await self._best_substance(query, hits, hit)
        except FramarUnavailable as exc:
            logger.warning("framar lookup unavailable: %s", exc)
            return {**base, "status": "unavailable", "message": "Framar could not be reached for this medication."}

        if not data.get("name"):
            return {**base, "status": "not_found", "message": "The Framar page for this name could not be read."}
        others = [h["title"] for h in hits if h["kind"] == hit["kind"] and h["url"] != hit["url"]][:5]
        return {**base, "status": "found", **data, "other_matches": others}

    async def _product(self, url: str) -> dict[str, Any]:
        return await self._page(url, lambda html: parse_product(html, url), _PAGE_TTL)

    async def _substance(self, url: str) -> dict[str, Any]:
        return await self._page(url, lambda html: parse_substance(html, url), _PAGE_TTL)

    async def _best_substance(self, query: str, hits: list[dict[str, str]], hit: dict[str, str]) -> dict[str, Any]:
        """Read the active-ingredient entry; if Framar's page is thin, use a matching leaflet instead.

        One substance often has several ATC entries (systemic, topical, ...), and
        some of them carry only a one-line description. The richest of the first
        three is used. If even that has no dosage or contraindications, a product
        named like the substance (e.g. "ПАРАЦЕТАМОЛ таблетки 500 мг") is read,
        provided its listed active ingredient is the same.
        """
        candidates = [h for h in matching_substances(query, hits) if h["url"] != hit["url"]][:2]
        pages = await asyncio.gather(*(self._substance(h["url"]) for h in [hit, *candidates]), return_exceptions=True)
        usable = [p for p in pages if isinstance(p, dict) and p.get("name")]
        if not usable:
            first = pages[0]
            if isinstance(first, BaseException):
                raise first
            return first

        def richness(page: dict[str, Any]) -> tuple[int, int]:
            topics = {p["topic"] for p in page["parts"]}
            return (len(topics & {"dosage", "contraindications", "side_effects", "interactions"}),
                    1 if page.get("interactions_url") else 0)

        best = max(usable, key=richness)  # max() keeps the first of equals: search order
        if richness(best)[0] >= 2:
            return best

        for product_hit in matching_products(query, hits)[:2]:
            try:
                product = await self._product(product_hit["url"])
            except FramarUnavailable:
                continue
            same = self._identity(product)[1] & {n for page in usable for n in self._identity(page)[1]}
            if product.get("has_leaflet") and same and len(product["active_ingredients"]) == 1:
                return {**product, "matched_as": "leaflet of a product with this single active ingredient"}
        return best

    async def _interaction_index(self, med: dict[str, Any]) -> dict[str, Any] | None:
        """Everything Framar lists as interacting with this medication, or None if unavailable."""
        url = med.get("interactions_url")
        if not url:
            return None
        try:
            overview = await self._page(url, parse_interaction_overview, _PAGE_TTL)
            entries, complete = overview["drugs"], False
            if overview["all_drugs_url"]:
                try:
                    entries = await self._page(overview["all_drugs_url"], parse_interaction_list, _PAGE_TTL)
                    complete = True
                except FramarUnavailable:
                    pass
            return {"entries": entries, "complete": complete, "foods": overview["foods"]}
        except FramarUnavailable as exc:
            logger.warning("framar interactions unavailable: %s", exc)
            return None

    @staticmethod
    def _identity(med: dict[str, Any]) -> tuple[set[str], set[str]]:
        atcs = {i["atc"] for i in med.get("active_ingredients", []) if i.get("atc")}
        names = {_collapse(_norm(i["name"])) for i in med.get("active_ingredients", []) if i.get("name")}
        return atcs, names

    def _find_entry(self, index: dict[str, Any] | None, other: dict[str, Any]) -> dict[str, str] | None:
        if not index:
            return None
        atcs, names = self._identity(other)
        for entry in index["entries"]:
            if (entry["atc"] and entry["atc"] in atcs) or _collapse(_norm(entry["name"])) in names:
                return entry
        return None

    async def _check_pair(self, a: dict[str, Any], b: dict[str, Any], index_a, index_b) -> dict[str, Any]:
        result: dict[str, Any] = {"between": [a["name"], b["name"]]}
        atcs_a, names_a = self._identity(a)
        atcs_b, names_b = self._identity(b)
        notes: list[str] = []
        if (atcs_a & atcs_b) or (names_a & names_b):
            result["same_active_ingredient"] = True
            notes.append(
                "Both contain the same active ingredient. Taking them together adds up the dose; "
                "the maximum daily dose in the leaflet applies to the total."
            )
        elif {c[:5] for c in atcs_a} & {c[:5] for c in atcs_b}:
            result["same_drug_class"] = True
            notes.append("Both belong to the same ATC drug class, so their effects and side effects can add up.")

        entry = self._find_entry(index_a, b) or self._find_entry(index_b, a)
        if entry:
            result.update(status="documented", severity=entry["severity"], source_url=entry["url"])
            try:
                detail = await self._page(entry["url"], parse_interaction_pair, _PAGE_TTL)
                text, truncated = _truncate(detail["text"], _PAIR_TEXT_MAX)
                result.update(framar_statement=detail["statement"], text=text, truncated=truncated)
            except FramarUnavailable:
                notes.append("The detail page for this interaction could not be loaded; only its severity is known.")
        elif index_a is None and index_b is None:
            result["status"] = "not_checked"
            notes.append(
                "Framar's interaction lists for these medications could not be read, so nothing is known "
                "from this source. Do not describe the combination as safe."
            )
        else:
            result["status"] = "none_listed"
            checked = [m["name"] for m, idx in ((a, index_a), (b, index_b)) if idx]
            partial = any(idx and not idx["complete"] for idx in (index_a, index_b)) or None in (index_a, index_b)
            notes.append(
                f"Framar's interaction list for {', '.join(checked)} has no entry for the other medication. "
                "This is NOT evidence that the combination is safe: the list may be incomplete, brand "
                "and combination products may be filed under another name, and doses and the "
                "patient's conditions matter."
                + (" The list could only be checked partially." if partial else "")
            )
        result["notes"] = notes
        return result

    async def lookup(self, names: list[str]) -> dict[str, Any]:
        """Look up each medication and, for two or more, check every pair. Never raises."""
        unique: list[str] = []
        for name in names:
            if _norm(name) and _norm(name) not in {_norm(u) for u in unique}:
                unique.append(name)
        skipped = unique[MAX_MEDICATIONS:]
        unique = unique[:MAX_MEDICATIONS]

        resolved = await asyncio.gather(*(self._resolve(name) for name in unique))
        found = [m for m in resolved if m["status"] == "found"]

        want_interactions = len(unique) >= 2
        indexes: dict[int, dict[str, Any] | None] = {}
        if found:
            loaded = await asyncio.gather(*(self._interaction_index(m) for m in found))
            indexes = {id(m): idx for m, idx in zip(found, loaded)}

        checks: list[dict[str, Any]] = []
        if want_interactions and len(found) >= 2:
            checks = list(await asyncio.gather(*(
                self._check_pair(a, b, indexes[id(a)], indexes[id(b)])
                for a, b in itertools.combinations(found, 2)
            )))

        budget = min(_PER_MEDICATION_MAX, _TEXT_BUDGET // max(1, len(found)))
        medications: list[dict[str, Any]] = []
        for med in resolved:
            if med["status"] != "found":
                medications.append(med)
                continue
            index = indexes.get(id(med))
            entry: dict[str, Any] = {
                "query": med["query"],
                "status": "found",
                "kind": med["kind"],
                "name": med["name"],
                "active_ingredients": med["active_ingredients"],
                "source_url": med["source_url"],
                "sections": _apply_budget(med["parts"], budget),
                "interactions_url": med.get("interactions_url"),
            }
            if med.get("latin_name"):
                entry["latin_name"] = med["latin_name"]
            if med.get("matched_as"):
                entry["matched_as"] = med["matched_as"]
            if med["kind"] == "product" and not med.get("has_leaflet"):
                entry["note"] = "This page has no patient leaflet; only the product description was found."
            if not entry["sections"]:
                entry["note"] = "Framar's page for this entry has no usable text."
            if med.get("listed_interaction_counts"):
                entry["listed_interaction_counts"] = med["listed_interaction_counts"]
            if index:
                if "listed_interaction_counts" not in entry and index["complete"]:
                    counts: dict[str, int] = {}
                    for item in index["entries"]:
                        counts[item["severity"]] = counts.get(item["severity"], 0) + 1
                    entry["listed_interaction_counts"] = counts
                if index["foods"]:
                    entry["food_and_drink_interactions"] = [
                        {"name": f["name"], "severity": f["severity"], "source_url": f["url"]}
                        for f in index["foods"][:6]
                    ]
            if med.get("other_matches"):
                entry["other_matches"] = med["other_matches"]
            medications.append(entry)

        statuses = {m["status"] for m in resolved}
        if statuses == {"found"}:
            status = "success"
        elif "found" in statuses:
            status = "partial"
        elif statuses == {"unavailable"}:
            status = "source_unavailable"
        else:
            status = "not_found"

        notes = [
            "Source: framar.bg (patient leaflets, active-ingredient pages and its interaction checker). "
            "It is a reference source, not medical advice for this person.",
            "State doses, contraindications and interactions only if they appear in this result, and link "
            "the source_url. If something is not in the result, say that it was not found in Framar.",
            "Section text is an extract; sections with truncated=true continue on the source page.",
        ]
        if want_interactions:
            notes.append(
                "An interaction check with status none_listed or not_checked does not mean the "
                "combination is safe. Recommend confirming with a pharmacist or doctor."
            )
        if want_interactions and len(found) < len(unique):
            notes.append("Not every medication was found, so interactions involving the missing ones were not checked.")
        if skipped:
            notes.append(f"Only the first {MAX_MEDICATIONS} medications were looked up; call again for: {', '.join(skipped)}.")

        result: dict[str, Any] = {
            "status": status,
            "source": "framar.bg",
            "retrieved_at": time.strftime("%Y-%m-%d %H:%M", time.localtime()),
            "medications": medications,
            "notes": notes,
        }
        if want_interactions:
            result["interaction_checks"] = checks
        if status == "source_unavailable":
            result["message"] = "Framar could not be reached."
        return result


_service: FramarService | None = None


def get_framar_service() -> FramarService:
    global _service
    if _service is None:
        _service = FramarService(get_settings())
    return _service
