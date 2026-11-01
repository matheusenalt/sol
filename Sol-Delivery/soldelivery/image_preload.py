"""Pré-busca conservadora de imagens, fora da thread gráfica.

A biblioteca é validada uma vez. Um índice invertido reduz a quantidade de
comparações fuzzy: pares sem tokens em comum não pontuam no image_similarity.
NUNCA confirma imagens automaticamente; o resultado é só uma sugestão de prévia.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from .images import _canonical, image_similarity


def _word_tokens(value, min_len=1):
    return {token for token in _canonical(value).split() if token.isalpha() and len(token) >= min_len}


class ImageMatcher:
    def __init__(self, image_rows):
        self.entries = []
        self.by_token = defaultdict(set)
        for item in image_rows:
            path, stem = str(item['path']), str(item['stem'])
            if Path(path).suffix.lower() not in {".jpg", ".jpeg", ".png"} or not Path(path).is_file():
                continue
            index = len(self.entries)
            self.entries.append((path, stem))
            for token in _word_tokens(stem):
                self.by_token[token].add(index)

    def best(self, name, description='', threshold=88):
        tokens = _word_tokens(name) | _word_tokens(description, 4)
        if not tokens:
            return ''
        candidates = set()
        for token in tokens:
            candidates.update(self.by_token.get(token, ()))
        best_score = threshold - 0.001
        best_path = ''
        for idx in candidates:
            path, stem = self.entries[idx]
            score = image_similarity(name, stem, description)
            # Mesmo critério de desempate da busca anterior.
            if score >= threshold and (score > best_score or
                    (score == best_score and (not best_path or Path(path).name.casefold() < Path(best_path).name.casefold()))):
                best_score, best_path = score, path
        return best_path


def build_previews(products, image_rows, cancelled=None):
    """Snapshot puro: não acessa SQLite, QWidget nem QPixmap na thread auxiliar.

    Mapeia ID -> (nome, descrição, caminho sugerido). Caminho vazio = sem sugestão.
    Produtos com imagem explicitamente escolhida não precisam de busca.
    """
    matcher = ImageMatcher(image_rows)
    result = {}
    for item in products:
        if cancelled is not None and cancelled.is_set():
            return None
        id_, name, description, image_path = (item['id'], item['name'], item['description'], item['image_path'])
        if (image_path and Path(image_path).suffix.lower() in {'.jpg','.jpeg','.png'}
                and Path(image_path).is_file()):
            path = ''  # a imagem confirmada será usada diretamente
        else:
            path = matcher.best(name, description)
        result[id_] = (name, description, path)
    return result
