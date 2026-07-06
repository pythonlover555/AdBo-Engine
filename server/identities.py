"""Random identity generation for the sign-up automation.

Names are GENERATED, not picked from a fixed list, so the supply is effectively
unlimited. A small character-level Markov model is trained on a seed corpus of
real first/last names; sampling it yields novel-but-name-like strings, and a
plausibility filter rejects anything that reads as gibberish. Swap the seed
corpora (or `random_identity`) for a real source without touching the HTTP or
extension code.
"""
from __future__ import annotations

import itertools
import random
import re
from collections import defaultdict
from typing import Any

# --- name generation (character-level Markov) -------------------------
# These seed lists TRAIN the generator; we never return them directly. With an
# order-3 model the reachable output space is far larger than the corpus while
# staying pronounceable. Expand the seeds to bias the style of generated names.

_FIRST_SEED = [
    "Marcus", "Felix", "Carter", "Lincoln", "Everett", "Sebastian", "Adrian",
    "Oliver", "Leo", "Oscar", "Julian", "Max", "Xavier", "Tristan", "Miles",
    "Wesley", "Colin", "Grant", "Dean", "Cole", "Blake", "Chase", "Cooper",
    "Dillon", "Graham", "Hayden", "Ivan", "Jace", "Kai", "Lance", "Lucas",
    "Mason", "Nolan", "Owen", "Parker", "Quinn", "Reed", "Seth", "Spencer",
    "Tucker", "Victor", "Warren", "Wyatt", "Asher", "Beau", "Calvin",
    "Declan", "Dominick", "Emmett", "Finn", "Harvey", "Isaac", "Jasper",
    "Knox", "Landon", "Milo", "Nico", "Orion", "Preston", "Rhett", "Silas",
    "Theo", "Uriah", "Vance", "Wade", "Zane", "Aurelia", "Bianca", "Celeste",
    "Delilah", "Elena", "Fiona", "Geneva", "Helena", "Iris", "Jade", "Kira",
    "Lena", "Mira", "Nora", "Opal", "Petra", "Rosa", "Selena", "Tessa",
    "Vera", "Willa", "Yara", "Zoe", "Aria", "Brynn", "Camila", "Daphne",
    "Elise", "Fallon", "Gia", "Hazel", "Ivy", "June", "Kiara", "Luna",
    "Maya", "Nina", "Paloma", "Remy", "Sage", "Talia", "Violet", "Wren",
    "Zara", "Adele", "Bridget", "Cora", "Diana", "Eloise", "Freya", "Greta",
]

_LAST_SEED = [
    "Abernathy", "Blackwell", "Chambers", "Donovan", "Ellsworth", "Fairchild",
    "Goodwin", "Hawthorne", "Ingalls", "Jamison", "Kearney", "Langford",
    "McAllister", "Navarro", "Osborn", "Pendleton", "Quigley", "Redmond",
    "Sinclair", "Thatcher", "Underwood", "Vickery", "Whitmore", "Yarborough",
    "Zimmerman", "Barclay", "Carmichael", "Dunlop", "Eastman", "Fitzpatrick",
    "Galloway", "Holloway", "Iverson", "Kessler", "Llewellyn", "Marlowe",
    "Northrop", "Prescott", "Radcliffe", "Sutherland", "Townsend", "Upton",
    "Blakely", "Crenshaw", "Davenport", "Ellison", "Fontaine", "Garrison",
    "Hollister", "Ishida", "Jorgensen", "Kendrick", "Lancaster", "Merritt",
    "Norwood", "Osborne", "Pemberton", "Quinlan", "Rothwell", "Sheffield",
    "Thornton", "Vickers", "Whitaker", "Yorkston", "Ashford", "Bowman",
    "Caldwell", "Dunbar", "Emerson", "Fielding", "Grayson", "Huntington",
    "Ingram", "Jarrett", "Kingsley", "Lamont", "McKenzie", "Nash", "Ogilvie",
    "Pearce", "Rowland", "Sterling", "Tavares", "Ulrich", "Vaughan", "Winslow",
    "Ziegler", "Bancroft", "Covington", "Delaney", "Everhart", "Farnsworth",
    "Goldstein", "Huxley", "Ireland", "Jansen", "Kowalski", "Lockhart",
    "Montague", "Nakamura", "OConnell", "Pritchard", "Rutherford", "Sawyer",
    "Templeton", "Valentine", "Weatherby", "Yamamoto", "Beaumont", "Crawford",
    "Drummond", "Fairbanks", "Goddard", "Harrington", "Ivers", "Johansen",
    "Kirkland", "Livingston", "MacIntyre", "Newell", "Oakley", "Porterfield",
    "Quarles", "Ridgeway", "Stanhope", "Tremblay", "Urbanski", "Vernon",
    "Wainwright", "Yates", "Zuniga",
]

_ORDER = 3  # Markov context length (chars)
_VOWELS = frozenset("aeiouy")


def _train(names: list[str], order: int) -> dict[str, list[str]]:
    """Build an order-N character transition table from `names`."""
    model: dict[str, list[str]] = defaultdict(list)
    for name in names:
        seq = ("^" * order) + name.lower() + "$"  # ^ = start pad, $ = end
        for i in range(len(seq) - order):
            model[seq[i : i + order]].append(seq[i + order])
    return model


def _looks_like_name(name: str) -> bool:
    """Reject gibberish: sane length, has a vowel, no triple letters, no run of
    4+ consonants."""
    if not (3 <= len(name) <= 11):
        return False
    if not any(c in _VOWELS for c in name):
        return False
    run = 0
    for i, c in enumerate(name):
        if i >= 2 and c == name[i - 1] == name[i - 2]:
            return False
        run = run + 1 if c not in _VOWELS else 0
        if run >= 4:
            return False
    return True


def _generate(model: dict[str, list[str]], fallback: list[str]) -> str:
    """Sample one name from the model, retrying until it looks like a name."""
    for _ in range(300):
        key = "^" * _ORDER
        out: list[str] = []
        while len(out) < 12:
            choices = model.get(key)
            if not choices:
                break
            ch = random.choice(choices)
            if ch == "$":
                break
            out.append(ch)
            key = (key + ch)[-_ORDER:]
        name = "".join(out)
        if _looks_like_name(name):
            return name.capitalize()
    return random.choice(fallback).capitalize()  # extremely rare safety net


_FIRST_MODEL = _train(_FIRST_SEED, _ORDER)
_LAST_MODEL = _train(_LAST_SEED, _ORDER)


def random_first_name() -> str:
    """A generated, name-like first name."""
    return _generate(_FIRST_MODEL, _FIRST_SEED)


def random_last_name() -> str:
    """A generated, name-like last name."""
    return _generate(_LAST_MODEL, _LAST_SEED)

EMAIL_DOMAINS = [
    "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
    "aol.com", "live.com",
]


def _slug(s: str) -> str:
    """Keep only a-z0-9 so the local-part is always a valid email."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


# --- guaranteed-unique e-mail tag -------------------------------------
# Names may repeat (people share names), but every EMAIL must be unique. The tag
# = a per-process random run id + a monotonic counter, appended to the local
# part. The counter makes tags unique within a running process; the run id keeps
# tags from different restarts apart. (For an absolute cross-restart guarantee,
# persist the counter to disk — this is the stateless, effectively-unique form:
# a collision needs the same name AND a 36-bit run-id clash AND an overlapping
# counter, which is astronomically unlikely.)

_B36 = "0123456789abcdefghijklmnopqrstuvwxyz"
_RUN_ID = ""
_SEQ = itertools.count(1)


def _b36(n: int) -> str:
    if n <= 0:
        return "0"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = _B36[r] + out
    return out


_RUN_ID = _b36(random.getrandbits(30))  # ~6 chars, fixed for this process


def _unique_tag() -> str:
    # A leading per-e-mail random part varies the look so consecutive emails
    # don't appear sequential; the run id + monotonic counter guarantee that the
    # tag (hence the email) is unique.
    return f"{_b36(random.getrandbits(15))}{_RUN_ID}{_b36(next(_SEQ))}"


def _make_email(first: str, last: str) -> str:
    f, l = _slug(first), _slug(last)
    # A natural-looking base from the name...
    bases = [
        f"{f}.{l}",
        f"{f}{l}",
        f"{f}_{l}",
        f"{f[0]}{l}",
        f"{f}{l[0]}",
        f"{l}.{f}",
    ]
    sep = random.choice(["", ".", "_"])
    # ...then the unique tag so no two emails ever collide.
    local = f"{random.choice(bases)}{sep}{_unique_tag()}"
    return f"{local}@{random.choice(EMAIL_DOMAINS)}"


def random_identity() -> dict[str, str]:
    """One generated full name + matching email (email derived from the name)."""
    first = random_first_name()
    last = random_last_name()
    return {
        "first_name": first,
        "last_name": last,
        "full_name": f"{first} {last}",
        "email": _make_email(first, last),
    }


# --- registration details (everything EXCEPT email/name) --------------
# The extension already holds email + name from the identity step, so the
# details endpoint supplies the rest of the sign-up form. The shipping ADDRESS
# (street/city/state/zip/phone) comes ROW-BY-ROW from the external US-address
# file (see address_book); DOB + gender stay random. If that file is unavailable
# or a row can't be normalized, we fall back to the generated values below.

from . import address_book

STREET_NAMES = [
    "Main", "Oak", "Pine", "Maple", "Cedar", "Elm", "Washington", "Lake",
    "Hill", "Park", "Sunset", "River", "Church", "Spring", "Highland",
    "Forest", "Franklin", "Center", "Walnut", "Chestnut", "Lincoln", "Adams",
]
STREET_SUFFIXES = ["St", "Ave", "Rd", "Dr", "Ln", "Blvd", "Ct", "Way", "Pl"]

CITIES = [
    "Springfield", "Franklin", "Greenville", "Bristol", "Clinton", "Madison",
    "Georgetown", "Salem", "Fairview", "Riverside", "Auburn", "Dayton",
    "Arlington", "Ashland", "Burlington", "Manchester", "Oxford", "Newport",
    "Milton", "Kingston", "Marion", "Oakland",
]

# 2-letter codes matching exactly the <select id="state"> options on the form.
STATES = [
    "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI",
    "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN",
    "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH",
    "OK", "OR", "PA", "PR", "RI", "SD", "SC", "TN", "TX", "UT", "VA", "VT",
    "WA", "WI", "WV", "WY",
]


def _phone() -> str:
    """A plausible 10-digit US number (area/exchange lead 2-9). Digits only;
    the form auto-formats on input."""
    digits = [str(random.randint(2, 9))] + [str(random.randint(0, 9)) for _ in range(2)]
    digits += [str(random.randint(2, 9))] + [str(random.randint(0, 9)) for _ in range(6)]
    return "".join(digits)


def _generated_address() -> dict[str, str]:
    """Fallback address when the external file is unavailable."""
    return {
        "address1": f"{random.randint(1, 9999)} {random.choice(STREET_NAMES)} "
        f"{random.choice(STREET_SUFFIXES)}",
        "city": random.choice(CITIES),
        "state": random.choice(STATES),
        "zip": f"{random.randint(1, 99999):05d}",
        "phone": _phone(),
    }


def _next_address() -> dict[str, str]:
    """The next address from the file (sequential cursor), validated against what
    the form accepts; falls back to a generated address if needed."""
    addr = address_book.next_address()
    if not addr or addr.get("state") not in STATES or not addr.get("address1"):
        return _generated_address()
    # Real street/city/state, but repair zip/phone if a row is malformed.
    if not re.fullmatch(r"\d{5}", addr.get("zip", "")):
        addr["zip"] = f"{random.randint(1, 99999):05d}"
    if not re.fullmatch(r"\d{10}", addr.get("phone", "")):
        addr["phone"] = _phone()
    return addr


def random_details() -> dict[str, Any]:
    """Registration-form details: a real US address pulled ROW-BY-ROW from the
    address file (street/city/state/zip/phone), plus random DOB + gender. Uses
    the value formats the form expects (2-letter state, 10-digit phone, 5-digit
    zip, zero-padded DOB with day capped at 28 so the date is always valid)."""
    addr = _next_address()
    return {
        "address1": addr["address1"],
        "city": addr["city"],
        "state": addr["state"],
        "zip": addr["zip"],
        "phone": addr["phone"],  # 10 digits, no separators
        "dob": {
            "month": f"{random.randint(1, 12):02d}",  # "01".."12"
            "day": f"{random.randint(1, 28):02d}",    # "01".."28" (always valid)
            "year": str(random.randint(1980, 2002)),  # adult age range
        },
        "gender": random.choice(["M", "F"]),
    }
