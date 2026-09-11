# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
import re
from dataclasses import dataclass
from genlayer import *
from urllib.parse import urlparse


DATE_RE = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
HTTPS = "https://"
MAX_PAGE_CHARS = 12000
MIN_CLAIM_CHARS = 12

ALLOWED_HOSTS = (
    "bbc.com",
    "www.bbc.com",
    "reuters.com",
    "www.reuters.com",
    "apnews.com",
    "www.apnews.com",
    "theguardian.com",
    "www.theguardian.com",
    "nytimes.com",
    "www.nytimes.com",
    "espn.com",
    "www.espn.com",
    "skysports.com",
    "www.skysports.com",
    "en.wikipedia.org",
    "wikipedia.org",
    "sec.gov",
    "www.sec.gov",
    "nasa.gov",
    "www.nasa.gov",
    "who.int",
    "www.who.int",
    "un.org",
    "www.un.org",
    "europa.eu",
    "www.europa.eu",
)

ALLOWED_SUFFIXES = (
    ".gov",
    ".gov.uk",
    ".gouv.fr",
    ".gob.mx",
    ".gc.ca",
    ".europa.eu",
    ".int",
)


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _host_allowed(url: str) -> bool:
    host = _host(url)
    if not host:
        return False
    for allowed in ALLOWED_HOSTS:
        base = allowed[4:] if allowed.startswith("www.") else allowed
        if host == allowed or host == base or host.endswith("." + base):
            return True
    for suffix in ALLOWED_SUFFIXES:
        if host.endswith(suffix):
            return True
    return False


def _require_https_url(url: str, label: str) -> str:
    cleaned = url.strip()
    if not cleaned.lower().startswith(HTTPS):
        raise gl.vm.UserError(f"{label} must be an https url")
    if not _host_allowed(cleaned):
        raise gl.vm.UserError(f"{label} host is not an allowed official source")
    return cleaned


def _pay(to: Address, amount: u256) -> None:
    if amount == 0:
        return
    gl.get_contract_at(to).emit_transfer(value=amount, on="finalized")


@allow_storage
@dataclass
class Attestation:
    attester: Address
    claim: str
    event_date: str
    source_url_a: str
    source_url_b: str
    stake: u256
    status: str
    verdict: str
    funds_disposition: str


class AttestLock(gl.Contract):
    attestations: TreeMap[str, Attestation]
    next_attestation_id: u256
    reserved_stakes: u256
    retained_stakes: u256

    def __init__(self):
        self.next_attestation_id = u256(1)
        self.reserved_stakes = u256(0)
        self.retained_stakes = u256(0)

    def _id(self) -> str:
        return str(int(self.next_attestation_id))

    def _get(self, attestation_id: str) -> Attestation:
        if attestation_id not in self.attestations:
            raise gl.vm.UserError("attestation not found")
        return self.attestations[attestation_id]

    def _extract_page(self, url: str, claim: str, event_date: str) -> dict:
        raw = gl.nondet.web.render(url, mode="text")
        page_text = raw if isinstance(raw, str) else str(raw)
        page_text = page_text[:MAX_PAGE_CHARS]
        prompt = f"""
Decide whether one official public page supports a dated factual claim.

Claim: {claim}
Required calendar date (YYYY-MM-DD): {event_date}
Source URL: {url}

Page text:
{page_text}

Return JSON only with exactly these fields:
{{
  "date_match": true or false,
  "related": true or false,
  "answer": "YES" or "NO" or "UNKNOWN"
}}

Rules:
- date_match is true only if the page is about that calendar day.
- related is true only if the page is about the same fact as the claim.
- answer is YES if the page clearly supports that the claim is true.
- answer is NO if the page clearly supports that the claim is false.
- answer is UNKNOWN if the page is incomplete, off-topic, undated, or inconclusive.
- Do not include any other keys or commentary.
"""
        parsed = gl.nondet.exec_prompt(prompt, response_format="json")
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        date_match = bool(parsed.get("date_match", False))
        related = bool(parsed.get("related", False))
        answer = str(parsed.get("answer", "UNKNOWN")).upper()
        if answer not in ("YES", "NO", "UNKNOWN"):
            answer = "UNKNOWN"
        if not date_match or not related:
            answer = "UNKNOWN"
        return {
            "date_match": date_match,
            "related": related,
            "answer": answer,
        }

    def _adjudicate(self, item: Attestation) -> dict:
        def decide() -> str:
            page_a = self._extract_page(item.source_url_a, item.claim, item.event_date)
            page_b = self._extract_page(item.source_url_b, item.claim, item.event_date)
            if (
                not page_a["date_match"]
                or not page_b["date_match"]
                or not page_a["related"]
                or not page_b["related"]
                or page_a["answer"] == "UNKNOWN"
                or page_b["answer"] == "UNKNOWN"
            ):
                verdict = "UNKNOWN"
            elif page_a["answer"] != page_b["answer"]:
                verdict = "DISAGREE"
            else:
                verdict = page_a["answer"]
            payload = {
                "date_match_a": page_a["date_match"],
                "date_match_b": page_b["date_match"],
                "related_a": page_a["related"],
                "related_b": page_b["related"],
                "answer_a": page_a["answer"],
                "answer_b": page_b["answer"],
                "verdict": verdict,
            }
            return json.dumps(payload, sort_keys=True)

        return json.loads(gl.eq_principle.strict_eq(decide))

    @gl.public.write.payable
    def create_attestation(
        self,
        claim: str,
        event_date: str,
        source_url_a: str,
        source_url_b: str,
    ) -> str:
        text = claim.strip()
        if len(text) < MIN_CLAIM_CHARS:
            raise gl.vm.UserError("claim is too short")
        if re.match(DATE_RE, event_date.strip()) is None:
            raise gl.vm.UserError("event_date must be YYYY-MM-DD")
        url_a = _require_https_url(source_url_a, "source_url_a")
        url_b = _require_https_url(source_url_b, "source_url_b")
        if _host(url_a) == _host(url_b):
            raise gl.vm.UserError("sources must come from two different hosts")
        stake = gl.message.value
        if stake == u256(0):
            raise gl.vm.UserError("stake must be greater than zero")

        attestation_id = self._id()
        self.attestations[attestation_id] = Attestation(
            attester=gl.message.sender_address,
            claim=text,
            event_date=event_date.strip(),
            source_url_a=url_a,
            source_url_b=url_b,
            stake=stake,
            status="OPEN",
            verdict="",
            funds_disposition="RESERVED",
        )
        self.next_attestation_id = self.next_attestation_id + u256(1)
        self.reserved_stakes = self.reserved_stakes + stake
        return attestation_id

    @gl.public.write
    def update_sources(
        self,
        attestation_id: str,
        source_url_a: str,
        source_url_b: str,
    ) -> None:
        item = self._get(attestation_id)
        if gl.message.sender_address != item.attester:
            raise gl.vm.UserError("only the attester can update sources")
        if item.status != "OPEN":
            raise gl.vm.UserError("only an open attestation can change sources")
        url_a = _require_https_url(source_url_a, "source_url_a")
        url_b = _require_https_url(source_url_b, "source_url_b")
        if _host(url_a) == _host(url_b):
            raise gl.vm.UserError("sources must come from two different hosts")
        item.source_url_a = url_a
        item.source_url_b = url_b
        self.attestations[attestation_id] = item

    @gl.public.write
    def cancel(self, attestation_id: str) -> None:
        item = self._get(attestation_id)
        if gl.message.sender_address != item.attester:
            raise gl.vm.UserError("only the attester can cancel")
        if item.status != "OPEN":
            raise gl.vm.UserError("only an open attestation can be cancelled")
        stake = item.stake
        item.status = "CANCELLED"
        item.funds_disposition = "REFUNDED_TO_ATTESTER"
        self.reserved_stakes = self.reserved_stakes - stake
        self.attestations[attestation_id] = item
        _pay(item.attester, stake)

    @gl.public.write
    def resolve(self, attestation_id: str) -> str:
        item = self._get(attestation_id)
        if item.status != "OPEN":
            raise gl.vm.UserError("attestation must be OPEN to resolve")
        result = self._adjudicate(item)
        verdict = str(result.get("verdict", "UNKNOWN")).upper()
        stake = item.stake

        if verdict == "YES":
            item.status = "ATTESTED"
            item.verdict = "YES"
            item.funds_disposition = "RETURNED_TO_ATTESTER"
            self.reserved_stakes = self.reserved_stakes - stake
            self.attestations[attestation_id] = item
            _pay(item.attester, stake)
        elif verdict == "NO":
            item.status = "REJECTED"
            item.verdict = "NO"
            item.funds_disposition = "RETAINED_BY_CONTRACT"
            self.reserved_stakes = self.reserved_stakes - stake
            self.retained_stakes = self.retained_stakes + stake
            self.attestations[attestation_id] = item
        else:
            item.verdict = verdict if verdict in ("UNKNOWN", "DISAGREE") else "UNKNOWN"
            self.attestations[attestation_id] = item
        return item.status if item.status != "OPEN" else item.verdict

    @gl.public.view
    def get_attestation(self, attestation_id: str) -> str:
        item = self._get(attestation_id)
        return json.dumps(
            {
                "attester": item.attester.as_hex,
                "claim": item.claim,
                "event_date": item.event_date,
                "source_url_a": item.source_url_a,
                "source_url_b": item.source_url_b,
                "stake": str(int(item.stake)),
                "status": item.status,
                "verdict": item.verdict,
                "funds_disposition": item.funds_disposition,
            },
            sort_keys=True,
        )

    @gl.public.view
    def get_attestation_status(self, attestation_id: str) -> str:
        return self._get(attestation_id).status

    @gl.public.view
    def get_attestation_count(self) -> str:
        return str(int(self.next_attestation_id) - 1)

    @gl.public.view
    def get_reserved_stakes(self) -> str:
        return str(int(self.reserved_stakes))

    @gl.public.view
    def get_retained_stakes(self) -> str:
        return str(int(self.retained_stakes))