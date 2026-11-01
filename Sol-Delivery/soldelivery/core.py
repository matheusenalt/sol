"""Regras de negócio sem dependência da interface gráfica."""
from __future__ import annotations
import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Optional
from rapidfuzz import fuzz

PRICE_RX = re.compile(r"(?:R\s*\$\s*:?\s*)?(\d{1,5}(?:[.,]\d{3})*[.,]\d{2})\b", re.I)
STOPWORDS = {"REFRI", "REFRIGERANTE", "DE", "DA", "DO", "DAS", "DOS", "GARRAFA", "LATA", "PET", "UN", "UNIDADE"}
UNRELIABLE = {"?", "�", "□", "[ILEGIVEL]"}


def normalize_name(value: str, dot: bool = True) -> str:
    name = re.sub(r"\s+", " ", str(value or "")).strip().upper()
    # Elimina pontos finais extras, não altera pontos decimais dentro do nome.
    name = name.rstrip(" .")
    return name + ("." if dot and name else "")


def price_to_cents(value) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (float, int, Decimal)):
        amount = Decimal(str(value))
    else:
        text = str(value).strip().replace("R$", "").replace("r$", "")
        text = re.sub(r"\s+", "", text)
        if not text:
            return None
        # Formatos aceitos: 1.234,56 / 1,234.56 / 8,75 / 8.75 / 8
        if "," in text and "." in text:
            if text.rfind(",") > text.rfind("."):
                text = text.replace(".", "").replace(",", ".")
            else:
                text = text.replace(",", "")
        elif "," in text:
            text = text.replace(",", ".")
        try:
            amount = Decimal(text)
        except InvalidOperation:
            return None
    if not amount.is_finite() or amount < 0:
        return None
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def cents_to_brl(cents: Optional[int], prefix: bool = True) -> str:
    if cents is None:
        return "—"
    a = f"{cents / 100:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return ("R$ " if prefix else "") + a


def clean_key(text: str) -> str:
    s = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode("ascii").upper()
    s = re.sub(r"(\d+)\s*,\s*(\d+)\s*L\b", lambda m: str(int(m[1]) * 1000 + int((m[2]+"00")[:3])) + "ML", s)
    s = re.sub(r"\b(\d+)\s*L\b", lambda m: str(int(m[1]) * 1000) + "ML", s)
    s = re.sub(r"\b(\d+)\s*ML\b", r"\1ML", s)
    s = re.sub(r"(?<=[A-Z])(?=\d)", " ", s)
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    tokens = [t for t in s.split() if t not in STOPWORDS]
    return " ".join(tokens)


def volume_ml(text: str) -> Optional[int]:
    k = clean_key(text)
    matches = re.findall(r"\b(\d{2,5})ML\b", k)
    return int(matches[-1]) if matches else None


def similarity(name: str, image_stem: str) -> float:
    """Pontuação conservadora: não confundir volume/sabor ZERO com regular."""
    a, b = clean_key(name), clean_key(image_stem)
    if not a or not b:
        return 0
    va, vb = volume_ml(name), volume_ml(image_stem)
    if va and vb and va != vb:
        return 0
    ta, tb = set(a.split()), set(b.split())
    if not any(re.search("[A-Z]",t) and not t.endswith("ML") for t in ta):
        return 0  # nome só informa volume: imagem seria um palpite
    if ("ZERO" in ta) != ("ZERO" in tb):
        return 0
    if ("LIGHT" in ta) != ("LIGHT" in tb):
        return 0
    score = (fuzz.WRatio(a, b) * .65 + fuzz.token_set_ratio(a, b) * .35)
    if va and not vb:
        score -= 12
    return max(0, round(score, 1))


@dataclass
class Extracted:
    name: str
    price_cents: Optional[int]
    category: str = "SEM CATEGORIA"
    status: str = "revisar"  # reconhecido, revisar, nao_identificado
    detail: str = ""
    source_line: str = ""
    addons: list[tuple[str, Optional[int]]] = field(default_factory=list)
    description: str = ""


# Categorias explícitas são indicativas; títulos novos exigem pistas de formatação.
KNOWN_CATEGORIES = {
    "BEBIDAS", "REFRIGERANTES", "SALGADOS", "PIZZAS", "MASSAS", "HAMBURGUERES",
    "LANCHES", "DOCES", "PORCOES", "CHURRASCOS", "SOBREMESAS", "CERVEJAS",
    "CONVENIENCIAS", "SUCOS", "SALADAS", "MARMITAS", "COMBOS", "ESPETINHOS",
    "SORVETES", "ADICIONAIS", "PROMOCOES", "ACAI", "PASTEIS", "PAES", "CAFE",
    "PRATOS", "LANCHONETE", "CHURRASCO", "MARMITEX", "PIZZA", "PORCOES E PETISCOS"
}
TABLE_HEADERS = {"PRODUTOS", "PRECO", "DESCRICAO", "VALOR", "CARDAPIO", "ITEM"}


def _ascii(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").upper().strip()


def clean_description(text: str) -> str:
    """Preserva caixa e pontuação do cliente; remove apenas espaços duplicados."""
    return " ".join(str(text or "").split())


def _looks_like_description(text: str, previous: Extracted | None) -> bool:
    if previous is None or not text or not re.search(r"[A-Za-zÀ-ÿ]", text):
        return False
    if re.search(r"\b\d+\s*(?:ML|L|KG|G|UN|FATIAS?)\b", text, re.I):
        return False
    norm = _ascii(text)
    terms = ("PAO", "QUEIJO", "BACON", "BIFE", "SALADA", "ALFACE", "TOMATE", "MOLHO", "MAIONESE", "INGREDIENTES", "COMPOSTO", "RECHEADO")
    if ',' in text and len(text.split()) >= 3:
        return True
    if text[0].islower() and len(text.split()) >= 3:
        return True
    if norm.startswith(("COM ", "ACOMPANHA ", "CONTEM ", "INGREDIENTES:")) and len(text.split()) >= 3:
        return True
    if len(text.split()) >= 6 and any(k in norm.split() for k in terms):
        return True
    return False


def _category_header(lines: list[str], i: int) -> bool:
    line = lines[i].strip()
    if re.search(r"\d", line) or not re.search(r"[A-Za-zÀ-ÿ]", line) or len(line.split()) > 4:
        return False
    normalized = _ascii(line.strip(" :"))
    next_text=next((v.strip() for v in lines[i+1:] if v.strip()),'')
    if next_text and PRICE_RX.fullmatch(next_text.replace('R$','').strip()):
        return False  # Pode ser um PRODUTO cujo preço está na próxima linha.
    if normalized in KNOWN_CATEGORIES or line.endswith(":"):
        return True
    # Inferência por formatação: caixa alta e linha curta antes de itens com preço.
    # Para não perder produtos sem preço, exige dois itens precificados à frente
    # ou espaço em branco antes do título. Em casos duvidosos, NÃO troca seção.
    if not line.isupper() or len(line) > 32 or normalized.startswith(('X-', 'REFRI ', 'COCA ', 'BATATA ', 'PIZZA ', 'SUCO ', 'PORCAO ')):
        return False
    ahead = [v for v in lines[i+1:i+5] if v.strip()]
    priced = sum(bool(PRICE_RX.search(v)) and bool(re.search("[A-Za-zÀ-ÿ]", PRICE_RX.sub("", v))) for v in ahead)
    blank_before = i == 0 or not lines[i-1].strip()
    return bool(ahead) and (priced >= 2 or (blank_before and priced >= 1))


def parse_lines(text: str, category: str = "SEM CATEGORIA", conservative: bool = True) -> list[Extracted]:
    """Reconstrói nome/descrição/preço sem inferir valores ou descartar linhas incertas."""
    found: list[Extracted] = []
    current_category = category
    lines = text.splitlines()
    pending: Extracted | None = None
    for i, raw in enumerate(lines):
        line = clean_description(raw)
        if not line:
            continue
        if _ascii(line.strip(" :")) in TABLE_HEADERS:
            continue
        if _category_header(lines, i):
            if pending is not None:
                found.append(pending)
                pending = None
            current_category = normalize_name(line.strip(" :"), False)
            continue
        matches = list(PRICE_RX.finditer(line))
        if matches:
            match = matches[-1]
            cents = price_to_cents(match.group(1))
            name = (line[:match.start()] + " " + line[match.end():]).strip(" -–|:;.")
            name = re.sub(r"(?:R\s*\$\s*:?\s*)$", "", name, flags=re.I).strip()
            if name and not re.search("[A-Za-zÀ-ÿ]", name):
                name = ""
            if not name and pending is not None and pending.price_cents is None:
                # Preço na linha seguinte ao nome e à descrição.
                pending.price_cents = cents
                pending.source_line += "\n" + raw
                pending.detail = "Conferir associação nome/descrição/preço no original"
                pending.status = "revisar"
                found.append(pending)
                pending = None
                continue
            if pending is not None:
                found.append(pending)
                pending = None
            if name:
                uncertain = any(c in name for c in UNRELIABLE)
                row = Extracted(normalize_name(name), cents, current_category,
                    "revisar" if (conservative or uncertain or current_category == "SEM CATEGORIA") else "reconhecido",
                    "Conferir leitura do texto original" if conservative or uncertain or current_category == "SEM CATEGORIA" else "", raw)
                pending = row
            else:
                found.append(Extracted("PRODUTO NÃO IDENTIFICADO", cents, current_category,
                    "nao_identificado", "Preço sem nome correspondente; revisar original", raw))
            continue
        if not re.search("[A-Za-zÀ-ÿ]", line):
            # Linha ilegível/solta: preserva a origem de modo auditável.
            if pending is not None:
                pending.source_line += "\n" + raw
                pending.status = "revisar"
                pending.detail = "Linha ambígua junto ao produto: verificar no original"
            continue
        if _looks_like_description(line, pending):
            if pending.description:
                pending.description += " " + line
            else:
                pending.description = line
            pending.source_line += "\n" + raw
            if conservative or pending.price_cents is None:
                pending.status = "revisar"
                pending.detail = "Verifique a descrição associada no original"
        else:
            if pending is not None:
                found.append(pending)
            pending = Extracted(normalize_name(line), None, current_category,
                "revisar", "Preço não encontrado; verificar se é título/descrição ou produto", raw)
    if pending is not None:
        found.append(pending)
    return found
