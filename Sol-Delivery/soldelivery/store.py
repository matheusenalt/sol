"""Dados locais, sem conexão com banco de dados da loja/cliente."""
from __future__ import annotations
import os
import sqlite3
from pathlib import Path
from datetime import datetime
from .core import Extracted, normalize_name


def default_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or (Path.home() / ".local" / "share")
    return Path(base) / "SolDelivery"


class Store:
    def __init__(self, db_path=None):
        self.path = Path(db_path) if db_path else default_data_dir() / "soldelivery.db"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(self.path))
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.executescript("""
        CREATE TABLE IF NOT EXISTS batches (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, archived_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
            category TEXT NOT NULL DEFAULT 'SEM CATEGORIA', original_name TEXT NOT NULL,
            name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_cents INTEGER, status TEXT NOT NULL DEFAULT 'revisar',
            detail TEXT NOT NULL DEFAULT '', source_line TEXT NOT NULL DEFAULT '',
            completed INTEGER NOT NULL DEFAULT 0, completion_source TEXT NOT NULL DEFAULT '', image_path TEXT NOT NULL DEFAULT '',
            image_confirmed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_products_batch ON products(batch_id,category,position);
        CREATE TABLE IF NOT EXISTS product_addons (
            id INTEGER PRIMARY KEY,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            price_cents INTEGER,
            position INTEGER NOT NULL DEFAULT 0,
            CHECK (price_cents IS NULL OR price_cents >= 0)
        );
        CREATE INDEX IF NOT EXISTS idx_addons_product ON product_addons(product_id,position,id);
        CREATE TABLE IF NOT EXISTS images (path TEXT PRIMARY KEY, stem TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)
        # Migração não destrutiva da 0.5.0; preserva IDs, imagens e conclusões.
        cols={r['name'] for r in self.connection.execute('PRAGMA table_info(products)')}
        if 'description' not in cols:
            self.connection.execute("ALTER TABLE products ADD COLUMN description TEXT NOT NULL DEFAULT ''")
        if 'completion_source' not in cols:
            self.connection.execute("ALTER TABLE products ADD COLUMN completion_source TEXT NOT NULL DEFAULT ''")
        batch_cols={r['name'] for r in self.connection.execute('PRAGMA table_info(batches)')}
        if 'archived_at' not in batch_cols:
            self.connection.execute("ALTER TABLE batches ADD COLUMN archived_at TEXT NOT NULL DEFAULT ''")
        self.connection.commit()

    def close(self):
        self.connection.close()

    def add_batch(self, name: str, source: str, products: list[Extracted]) -> int:
        with self.connection:
            cur = self.connection.execute("INSERT INTO batches(name,source) VALUES (?,?)", (name, source))
            batch_id = int(cur.lastrowid)
            # Um produto e os acréscimos explicitamente vinculados na mesma transação.
            for i,p in enumerate(products):
                product_cur=self.connection.execute("""INSERT INTO products(
                    batch_id,category,original_name,name,description,price_cents,status,detail,source_line,position)
                    VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (batch_id,p.category,p.name,p.name,p.description,p.price_cents,p.status,p.detail,p.source_line,i))
                if p.addons:
                    self.connection.executemany(
                        "INSERT INTO product_addons(product_id,name,price_cents,position) VALUES (?,?,?,?)",
                        [(int(product_cur.lastrowid),normalize_name(name,False),cents,j)
                            for j,(name,cents) in enumerate(p.addons)]
                    )
        return batch_id

    def batches(self, include_archived=False):
        query="SELECT * FROM batches"
        if not include_archived:
            query+=" WHERE archived_at=''"
        return self.connection.execute(query+" ORDER BY id DESC").fetchall()

    def batch(self, batch_id: int):
        return self.connection.execute("SELECT * FROM batches WHERE id=?",(batch_id,)).fetchone()

    def archive_batch(self, batch_id: int, archived=True):
        if not self.batch(batch_id):
            raise ValueError('Cardápio não encontrado')
        # Arquivar nunca altera produtos ou conclui itens pendentes.
        with self.connection:
            self.connection.execute("UPDATE batches SET archived_at=CASE WHEN ? THEN datetime('now') ELSE '' END WHERE id=?",(int(archived),batch_id))

    def batch_counts(self,batch_id: int):
        row=self.connection.execute("""SELECT COUNT(*) total,
                COALESCE(SUM(CASE WHEN completed=1 THEN 1 ELSE 0 END),0) completed,
                COALESCE(SUM(CASE WHEN completed=0 THEN 1 ELSE 0 END),0) pending,
                COALESCE(SUM(CASE WHEN completed=0 AND status!='reconhecido' THEN 1 ELSE 0 END),0) review
                FROM products WHERE batch_id=?""",(batch_id,)).fetchone()
        return dict(row)

    def products(self, batch_id: int, category="", show="todos", search=""):
        query = "SELECT * FROM products WHERE batch_id=?"
        args = [batch_id]
        if category and category != "TODAS":
            query += " AND category=?"; args.append(category)
        if show == "pendentes":
            query += " AND completed=0"
        elif show == "concluidos":
            query += " AND completed=1"
        elif show == "revisar":
            query += " AND completed=0 AND status!='reconhecido'"
        if search:
            query += " AND (name LIKE ? OR original_name LIKE ? OR description LIKE ?)"
            args.extend([f"%{search}%"]*3)
        query += " ORDER BY category COLLATE NOCASE, position, id"
        return self.connection.execute(query,args).fetchall()

    def by_id(self, product_id: int):
        return self.connection.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()

    def categories(self, batch_id: int):
        return [r[0] for r in self.connection.execute(
            "SELECT DISTINCT category FROM products WHERE batch_id=? ORDER BY category COLLATE NOCASE", (batch_id,))]

    def update_product(self, product_id, name, price_cents, category, confirmed=False, description=None):
        status = "reconhecido" if confirmed and name and price_cents is not None else "revisar"
        current=self.by_id(product_id)
        if current is None: raise ValueError('Produto não encontrado')
        from .core import clean_description
        description=clean_description(description if description is not None else current['description'])
        changed=(normalize_name(name, self.setting('dot','1')=='1') != current['name']
                 or price_cents != current['price_cents'] or description != current['description']
                 or (category or 'SEM CATEGORIA')!=current['category'])
        self.connection.execute("""UPDATE products SET name=?,description=?,price_cents=?,category=?,status=?,
            completed=CASE WHEN ? THEN 0 ELSE completed END,
            completion_source=CASE WHEN ? THEN '' ELSE completion_source END,
            detail=CASE WHEN ?='reconhecido' THEN '' ELSE detail END WHERE id=?""",
            (normalize_name(name, self.setting("dot","1") == "1"), description, price_cents,
             category or "SEM CATEGORIA", status, int(changed), int(changed), status, product_id))
        self.connection.commit()

    def update_price(self, product_id: int, price_cents: int):
        """Correção rápida do valor sem validar automaticamente um OCR incerto."""
        if not self.by_id(product_id):
            raise ValueError("Produto não encontrado")
        if not isinstance(price_cents,int) or price_cents < 0:
            raise ValueError("Preço inválido")
        with self.connection:
            # Mudança de preço após conclusão exige conferir o cadastro publicado.
            self.connection.execute(
                "UPDATE products SET price_cents=?,completed=CASE WHEN price_cents IS NOT ? THEN 0 ELSE completed END, completion_source=CASE WHEN price_cents IS NOT ? THEN '' ELSE completion_source END WHERE id=?",
                (price_cents,price_cents,price_cents,product_id)
            )

    def mark_completed(self, product_id: int, completed: bool):
        item = self.by_id(product_id)
        if not item:
            raise ValueError("Produto não encontrado")
        if completed and item['completed'] and item['completion_source']=='site':
            return  # já confirmado pelo site; clique no Mini pode avançar sem erro
        if completed and (item["status"] != "reconhecido" or item["price_cents"] is None):
            raise ValueError("Confirme o nome e o preço antes de concluir")
        self.connection.execute("UPDATE products SET completed=?,completion_source=? WHERE id=?", (int(completed),"manual" if completed else "",product_id))
        self.connection.commit()

    def synchronize_site(self, batch_id: int, comparisons: list[dict]) -> dict:
        """Marca como concluídos SOMENTE itens com nome e preço únicos e iguais.

        Se o site mudou, reabre apenas os itens marcados por auditorias anteriores;
        nunca apaga conclusões manuais. Operação atômica, somente na lista atual.
        """
        from .audit import audit_key
        rows=self.products(batch_id)
        by_id={row['id']:row for row in rows}
        if len(comparisons)!=len(rows) or {r['id'] for r in comparisons}!=set(by_id):
            raise ValueError('Auditoria não corresponde à lista completa; não foi aplicada')
        accepted=set()
        for result in comparisons:
            item=by_id[result['id']]
            if (result.get('match_kind')!='preco_igual' or
                    item['status']=='nao_identificado' or
                    item['price_cents'] is None or
                    item['price_cents']!=result.get('online_price') or
                    not audit_key(item['name']) or
                    audit_key(item['name'])!=audit_key(result.get('online_name','')) or
                    '?' in item['name'] or '\ufffd' in item['name']):
                continue
            accepted.add(item['id'])
        newly=0;reopened=0
        with self.connection:
            for row in rows:
                pid=row['id']
                if pid in accepted:
                    if not row['completed']:
                        self.connection.execute(
                            "UPDATE products SET completed=1,completion_source='site' WHERE id=?",(pid,))
                        newly+=1
                elif row['completed'] and row['completion_source']=='site':
                    self.connection.execute(
                        "UPDATE products SET completed=0,completion_source='' WHERE id=?",(pid,))
                    reopened+=1
        return {'matched':len(accepted),'newly_completed':newly,'reopened':reopened}

    def apply_dot(self, batch_id: int, dot: bool):
        with self.connection:
            for row in self.connection.execute("SELECT id, name FROM products WHERE batch_id=?", (batch_id,)).fetchall():
                self.connection.execute("UPDATE products SET name=? WHERE id=?", (normalize_name(row["name"], dot), row["id"]))
        self.set_setting("dot", "1" if dot else "0")

    def set_image(self, product_id: int, path: str, confirmed=True):
        self.connection.execute("UPDATE products SET image_path=?,image_confirmed=? WHERE id=?", (path, int(confirmed), product_id))
        self.connection.commit()

    def addons(self, product_id: int):
        """Acréscimos associados EXPLICITAMENTE ao produto, nunca por palpite do OCR."""
        return self.connection.execute(
            "SELECT id,name,price_cents FROM product_addons WHERE product_id=? ORDER BY position,id",
            (product_id,)
        ).fetchall()

    def replace_addons(self, product_id: int, addons):
        """Salva uma lista revisada no SQLite; não altera outros produtos."""
        if not self.by_id(product_id):
            raise ValueError("Produto não encontrado")
        validated = []
        for name, cents in addons:
            name = normalize_name(name, False)
            if not name or (cents is not None and (not isinstance(cents, int) or cents < 0)):
                raise ValueError("Acréscimo com nome ou preço inválido")
            validated.append((name, cents))
        with self.connection:
            self.connection.execute("DELETE FROM product_addons WHERE product_id=?", (product_id,))
            self.connection.executemany(
                "INSERT INTO product_addons(product_id,name,price_cents,position) VALUES (?,?,?,?)",
                [(product_id,name,cents,i) for i,(name,cents) in enumerate(validated)]
            )

    def setting(self, key: str, default="") -> str:
        row = self.connection.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row[0] if row else default

    def set_setting(self,key,value):
        self.connection.execute("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(key,str(value)))
        self.connection.commit()

    def image_rows(self):
        return self.connection.execute("SELECT path, stem FROM images").fetchall()

    def register_image(self, path: str, product_name: str | None = None):
        """Inclui uma foto selecionada da web na busca local futura."""
        photo=Path(path)
        if not photo.is_file():
            raise FileNotFoundError(str(photo))
        self.connection.execute("INSERT OR REPLACE INTO images(path,stem) VALUES (?,?)", (str(photo), product_name or photo.stem))
        self.connection.commit()

    def index_image_folder(self, folder: str) -> int:
        supported = {".png", ".jpg", ".jpeg"}
        paths = []
        for root, dirs, names in os.walk(folder):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for name in names:
                path = Path(root) / name
                if path.suffix.lower() in supported:
                    paths.append((str(path), path.stem))
        web_images_dir = default_data_dir() / "web_images"
        if web_images_dir.is_dir():
            for photo in web_images_dir.iterdir():
                if photo.is_file() and photo.suffix.lower() in supported:
                    # Os nomes foram atribuídos ao produto ao salvar, sem o ID aleatório final.
                    import re
                    stem=re.sub(r"-[0-9a-f]{10}$", "", photo.stem, flags=re.I)
                    paths.append((str(photo), stem))
        with self.connection:
            self.connection.execute("DELETE FROM images")
            self.connection.executemany("INSERT OR REPLACE INTO images(path,stem) VALUES (?,?)", paths)
        self.set_setting("image_folder", folder)
        return len(paths)
