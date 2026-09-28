#!/usr/bin/env python3
"""Bounded read-only PCI/USB inventory for Hardware Pack matching."""

from __future__ import annotations

import os
import platform

MAX_DEVICES = 128
MAX_MODALIAS_CHARS = 512
MAX_DRIVER_CHARS = 160


def _read_text(path: str, limit: int) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="strict") as handle:
            value = handle.read(limit + 1)
    except (OSError, UnicodeError):
        return ""
    if len(value) > limit:
        return ""
    return value.strip()


def _driver_name(device_path: str) -> str | None:
    link = os.path.join(device_path, "driver")
    if not os.path.islink(link):
        return None
    try:
        name = os.path.basename(os.path.realpath(link))
    except OSError:
        return None
    if not name or len(name) > MAX_DRIVER_CHARS or "\x00" in name:
        return None
    return name


def _bus_devices(bus: str, root: str) -> list[dict]:
    try:
        names = sorted(os.listdir(root))
    except (FileNotFoundError, NotADirectoryError):
        return []
    except OSError as exc:
        raise ValueError(f"{bus} hardware inventory is unavailable") from exc

    result = []
    for name in names:
        if len(result) >= MAX_DEVICES:
            break
        path = os.path.join(root, name)
        modalias = _read_text(os.path.join(path, "modalias"), MAX_MODALIAS_CHARS)
        if not modalias:
            continue
        result.append({
            "bus": bus,
            "modalias": modalias,
            "driver": _driver_name(path),
        })
    return result


def read_hardware_inventory(
    *,
    pci_root: str = "/sys/bus/pci/devices",
    usb_root: str = "/sys/bus/usb/devices",
    architecture: str | None = None,
    kernel_abi: str | None = None,
) -> dict:
    arch = (architecture or platform.machine()).strip()
    abi = (kernel_abi or platform.release()).strip()
    if not arch or len(arch) > 64:
        raise ValueError("hardware architecture is unavailable")
    if not abi or len(abi) > 160:
        raise ValueError("kernel ABI is unavailable")

    raw = _bus_devices("pci", pci_root) + _bus_devices("usb", usb_root)
    raw = raw[:MAX_DEVICES]
    devices = [
        {
            "id": f"device-{index:03d}",
            "bus": item["bus"],
            "modalias": item["modalias"],
            "driver": item["driver"],
        }
        for index, item in enumerate(raw, start=1)
    ]
    return {
        "schema": "ordax.hardware-inventory/1",
        "architecture": arch,
        "kernelAbi": abi,
        "devices": devices,
    }
