"""Chiffrement du carnet : AES-GCM 256 bits, clé dérivée de la phrase secrète (PBKDF2-SHA256).
Format identique à celui de l'appli (docs/carnet.js)."""
import base64, json, os
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITER = 210_000
_cles = {}

def _cle(phrase: str, sel: bytes) -> bytes:
    k = (phrase, sel)
    if k not in _cles:
        _cles[k] = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sel, iterations=ITER).derive(phrase.encode("utf-8"))
    return _cles[k]

b64 = lambda b: base64.b64encode(b).decode()
unb64 = lambda s: base64.b64decode(s)

def chiffre(obj, phrase: str, sel_b64: str) -> dict:
    sel = unb64(sel_b64); iv = os.urandom(12)
    ct = AESGCM(_cle(phrase, sel)).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode("utf-8"), None)
    return {"v": 1, "alg": "AES-GCM", "kdf": "PBKDF2-SHA256", "iter": ITER, "sel": sel_b64, "iv": b64(iv), "ct": b64(ct)}

def dechiffre(enveloppe: dict, phrase: str):
    cle = _cle(phrase, unb64(enveloppe["sel"]))
    clair = AESGCM(cle).decrypt(unb64(enveloppe["iv"]), unb64(enveloppe["ct"]), None)
    return json.loads(clair.decode("utf-8"))
