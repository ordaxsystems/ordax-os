"""Native-only encrypted session vault; the OrdaX HTTPS gateway remains identity SSOT.

USB media can be copied. Short PINs are insufficient to protect an offline
refresh token; this vault requires a strong local passphrase, not a six-digit PIN.
No credential material crosses the trusted Native/Surface JS boundary.
"""
from __future__ import annotations

import base64
import ctypes
import ctypes.util
import hashlib
import hmac
import json
import os
import secrets
import stat

VAULT_SCHEMA = "ordax.native-account-vault/1"
VAULT_MIN_PASSPHRASE_CHARS = 16
VAULT_BYTES_MAX = 48_000
COOKIE_NAMES = frozenset(("ordax_access", "ordax_refresh"))


class AccountVaultError(RuntimeError):
    pass


def _crypto():
    # musl/minimal runtimes need not ship ldconfig; Python TLS uses this same SONAME.
    name = ctypes.util.find_library("crypto") or "libcrypto.so.3"
    try:
        lib = ctypes.CDLL(name)
        ptr, integer = ctypes.c_void_p, ctypes.c_int
        lib.EVP_CIPHER_CTX_new.argtypes = []
        lib.EVP_CIPHER_CTX_new.restype = ptr
        lib.EVP_CIPHER_CTX_free.argtypes = [ptr]
        lib.EVP_CIPHER_CTX_free.restype = None
        lib.EVP_aes_256_gcm.argtypes = []
        lib.EVP_aes_256_gcm.restype = ptr
        for method in ("EVP_EncryptInit_ex", "EVP_DecryptInit_ex"):
            fn = getattr(lib, method)
            fn.argtypes = [ptr, ptr, ptr, ptr, ptr]
            fn.restype = integer
        for method in ("EVP_EncryptUpdate", "EVP_DecryptUpdate"):
            fn = getattr(lib, method)
            fn.argtypes = [ptr, ptr, ptr, ptr, integer]
            fn.restype = integer
        for method in ("EVP_EncryptFinal_ex", "EVP_DecryptFinal_ex"):
            fn = getattr(lib, method)
            fn.argtypes = [ptr, ptr, ptr]
            fn.restype = integer
        lib.EVP_CIPHER_CTX_ctrl.argtypes = [ptr, integer, integer, ptr]
        lib.EVP_CIPHER_CTX_ctrl.restype = integer
        return lib
    except (OSError, AttributeError) as exc:
        raise AccountVaultError("OpenSSL AES-GCM unavailable") from exc


def _aes_gcm(key: bytes, nonce: bytes, data: bytes, aad: bytes, *, tag: bytes | None = None):
    if len(key) != 32 or len(nonce) != 12 or len(data) > VAULT_BYTES_MAX:
        raise AccountVaultError("invalid cipher arguments")
    lib = _crypto()
    decrypt = tag is not None
    if decrypt and len(tag) != 16:
        raise AccountVaultError("invalid authentication tag")
    ctx = lib.EVP_CIPHER_CTX_new()
    if not ctx:
        raise AccountVaultError("cipher unavailable")
    try:
        init = lib.EVP_DecryptInit_ex if decrypt else lib.EVP_EncryptInit_ex
        update = lib.EVP_DecryptUpdate if decrypt else lib.EVP_EncryptUpdate
        final = lib.EVP_DecryptFinal_ex if decrypt else lib.EVP_EncryptFinal_ex
        if init(ctx, lib.EVP_aes_256_gcm(), None, key, nonce) != 1:
            raise AccountVaultError("cipher initialization failed")
        count = ctypes.c_int()
        if aad and update(ctx, None, ctypes.byref(count), aad, len(aad)) != 1:
            raise AccountVaultError("associated data rejected")
        output = ctypes.create_string_buffer(len(data) + 16)
        if update(ctx, output, ctypes.byref(count), data, len(data)) != 1:
            raise AccountVaultError("cipher operation failed")
        length = count.value
        if decrypt and lib.EVP_CIPHER_CTX_ctrl(ctx, 0x11, 16, tag) != 1:
            raise AccountVaultError("tag rejected")
        tail = ctypes.c_int()
        if final(ctx, ctypes.byref(output, length), ctypes.byref(tail)) != 1:
            raise AccountVaultError("vault authentication failed")
        result = output.raw[:length + tail.value]
        if decrypt:
            return result
        auth_tag = ctypes.create_string_buffer(16)
        if lib.EVP_CIPHER_CTX_ctrl(ctx, 0x10, 16, auth_tag) != 1:
            raise AccountVaultError("tag unavailable")
        return result, auth_tag.raw
    finally:
        lib.EVP_CIPHER_CTX_free(ctx)


def _decode(value: object, expected_length: int | None = None) -> bytes:
    if not isinstance(value, str) or len(value) > VAULT_BYTES_MAX * 2:
        raise AccountVaultError("invalid vault encoding")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise AccountVaultError("invalid vault encoding") from exc
    if expected_length is not None and len(raw) != expected_length:
        raise AccountVaultError("invalid vault field length")
    return raw


def _valid_cookies(value: object) -> bool:
    return isinstance(value, dict) and set(value) == COOKIE_NAMES and all(
        isinstance(cookie, str) and 0 < len(cookie) <= 16384
        and all(ch not in cookie for ch in ("\r", "\n", ";"))
        for cookie in value.values()
    )


def _secure_dir(path: str) -> None:
    parent = os.path.dirname(path)
    os.makedirs(parent, mode=0o700, exist_ok=True)
    info = os.lstat(parent)
    if (not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700
            or info.st_uid != os.geteuid()):
        raise AccountVaultError("unsafe vault directory")


def _validate_file(info) -> None:
    if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_uid != os.geteuid() or info.st_nlink != 1
            or not 0 < info.st_size <= VAULT_BYTES_MAX):
        raise AccountVaultError("unsafe vault file")


def _read(path: str) -> dict | None:
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return None
    _validate_file(info)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                 | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as handle:
        opened = os.fstat(handle.fileno())
        _validate_file(opened)
        if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
            raise AccountVaultError("vault file replaced while opening")
        raw = handle.read(VAULT_BYTES_MAX + 1)
    if len(raw) > VAULT_BYTES_MAX:
        raise AccountVaultError("vault too large")
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise AccountVaultError("malformed vault") from exc
    if (not isinstance(value, dict)
            or set(value) != {"schema", "origin", "salt", "nonce", "ciphertext", "tag"}
            or value.get("schema") != VAULT_SCHEMA):
        raise AccountVaultError("unsupported vault format")
    return value


def _write(path: str, value: dict) -> None:
    _secure_dir(path)
    raw = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(raw) > VAULT_BYTES_MAX:
        raise AccountVaultError("vault too large")
    temporary = f"{path}.tmp.{secrets.token_hex(16)}"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                 | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0), 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(os.path.dirname(path), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def tpm2_pin_preflight(
    version_path: str = "/sys/class/tpm/tpm0/tpm_version_major",
    resource_manager_path: str = "/dev/tpmrm0",
) -> dict[str, bool | str]:
    """Read-only hardware inventory; deliberately NOT authorization to use a PIN.

    A TPM device and kernel driver are only prerequisites. They do not prove
    a nonexportable sealing key, TPM dictionary-attack protection, trusted
    boot measurements, device recovery, or safe USB transfer. A separate
    reviewed enrollment/unseal protocol is mandatory before enabling PIN
    persistence. Do not add credentials to this diagnostic or open the TPM.
    """
    result: dict[str, bool | str] = {
        "tpm2_detected": False,
        "resource_manager_accessible": False,
        "hardware_key_enrolled": False,
        "short_pin_reboot_enabled": False,
        "status": "tpm2-unavailable",
    }
    if os.name != "posix":
        return result
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        fd = os.open(version_path, flags)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                return result
            version = os.read(fd, 8).strip()
        finally:
            os.close(fd)
    except (OSError, ValueError):
        return result
    if version != b"2":
        return result
    result["tpm2_detected"] = True
    result["status"] = "tpm2-resource-manager-unavailable"
    try:
        info = os.lstat(resource_manager_path)
        if not stat.S_ISCHR(info.st_mode) or not os.access(
            resource_manager_path, os.R_OK | os.W_OK
        ):
            return result
    except OSError:
        return result
    result["resource_manager_accessible"] = True
    result["status"] = "tpm2-hardware-candidate-only-not-enrolled"
    return result


class NativeAccountVault:
    """Stores only account cookies, unlocked by a strong device-local passphrase."""

    def __init__(self, path: str, origin: str):
        if not os.path.isabs(path) or not origin.startswith("https://"):
            raise ValueError("vault path/origin invalid")
        self.path = path
        self.origin = hashlib.sha256(origin.encode()).hexdigest()
        self._salt: bytes | None = None
        self._key: bytes | None = None

    def lock(self) -> None:
        self._salt = None
        self._key = None

    def unlock(self, secret: str) -> dict[str, str]:
        self.lock()
        if not isinstance(secret, str) or len(secret) < VAULT_MIN_PASSPHRASE_CHARS:
            return {}
        _secure_dir(self.path)
        value = _read(self.path)
        if value is None:
            salt = secrets.token_bytes(32)
        else:
            if not isinstance(value["origin"], str) or not hmac.compare_digest(value["origin"], self.origin):
                raise AccountVaultError("vault bound to another gateway")
            salt = _decode(value["salt"], 32)
        key = hashlib.scrypt(secret.encode("utf-8"), salt=salt,
                             n=1 << 16, r=8, p=1,
                             maxmem=128 * 1024 * 1024, dklen=32)
        cookies = {}
        if value is not None:
            aad = (VAULT_SCHEMA + ":" + self.origin).encode()
            plain = _aes_gcm(key, _decode(value["nonce"], 12),
                             _decode(value["ciphertext"]), aad,
                             tag=_decode(value["tag"], 16))
            try:
                cookies = json.loads(plain)
            except (UnicodeError, ValueError) as exc:
                raise AccountVaultError("vault payload invalid") from exc
            if not _valid_cookies(cookies):
                raise AccountVaultError("vault cookies invalid")
        self._salt = salt
        self._key = key
        return cookies

    def save(self, cookies: dict[str, str]) -> None:
        if self._key is None or self._salt is None or not _valid_cookies(cookies):
            return
        nonce = secrets.token_bytes(12)
        plain = json.dumps(cookies, separators=(",", ":")).encode()
        aad = (VAULT_SCHEMA + ":" + self.origin).encode()
        encrypted, tag = _aes_gcm(self._key, nonce, plain, aad)
        encode = lambda data: base64.b64encode(data).decode("ascii")
        _write(self.path, {"schema": VAULT_SCHEMA, "origin": self.origin,
                           "salt": encode(self._salt), "nonce": encode(nonce),
                           "ciphertext": encode(encrypted), "tag": encode(tag)})

    def clear(self) -> None:
        self.lock()
        _secure_dir(self.path)
        try:
            info = os.lstat(self.path)
        except FileNotFoundError:
            return
        _validate_file(info)
        os.unlink(self.path)
        directory_fd = os.open(os.path.dirname(self.path), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
