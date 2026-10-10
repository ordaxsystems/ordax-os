from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILDER = (ROOT / "bootstrap/initramfs/build.py").read_text(encoding="utf-8")
PORTABLE_INIT = (ROOT / "bootstrap/initramfs/portable_init.sh").read_text(encoding="utf-8")


def test_fixed_initramfs_can_identify_fat32_esp_label():
    assert '"CONFIG_BLKID": "y"' in BUILDER
    assert '"CONFIG_FEATURE_VOLUMEID_FAT": "y"' in BUILDER
    assert 'blkid "$device"' in PORTABLE_INIT
    assert 'LABEL="ORDAX-ESP"' in PORTABLE_INIT
    assert 'resolve_portable_devices /sys/block /dev' in PORTABLE_INIT


def test_portable_data_label_support_remains_present():
    assert '"CONFIG_FEATURE_VOLUMEID_EXFAT": "y"' in BUILDER
    assert 'LABEL="ORDAX-DATA"' in PORTABLE_INIT
    assert 'resolve_portable_devices /sys/block /dev' in PORTABLE_INIT
