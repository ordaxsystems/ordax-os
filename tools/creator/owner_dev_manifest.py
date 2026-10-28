#!/usr/bin/env python3
"""Materialize Owner/Development bootstrap manifest; shared by local builds and CI."""
import hashlib, json, os, pathlib, sys
def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
output = pathlib.Path(sys.argv[1])
manifest = json.loads(pathlib.Path('docs/contracts/minimal-bootstrap.json').read_text(encoding='utf-8'))
profiles = json.loads(pathlib.Path('docs/contracts/distribution-profiles.json').read_text(encoding='utf-8'))
owner_profile_id = 'owner-development'
owner_profile = profiles['profiles'].get(owner_profile_id)
if not isinstance(owner_profile, dict):
    raise SystemExit('canonical owner-development profile is missing')
# The owner-development profile is the contract; GitHub Actions is only one
# optional executor. A local manifest must not depend on a workflow filename.
owner_profile_token = f'ordax.distribution_profile={owner_profile_id}'
keep = {'uefi-boot', 'kernel', 'initramfs', 'bootstrap-orchestrator', 'bootstrap-recovery'}
manifest['artifact_groups'] = [group for group in manifest['artifact_groups'] if group['id'] in keep]
groups = {group['id']: group for group in manifest['artifact_groups']}
uefi = groups['uefi-boot']
owner_entry_dir = pathlib.Path('out/owner-prototype/boot-entries')
owner_entry_dir.mkdir(parents=True, exist_ok=True)
owner_entry_specs = {
    '/loader/entries/ordax.conf': (
        'boot/esp/loader/entries/ordax.conf',
        'ordax.mode=normal',
        'ordax-owner-development.conf',
    ),
    '/loader/entries/ordax-recovery.conf': (
        'boot/esp/loader/entries/ordax-recovery.conf',
        'ordax.mode=recovery',
        'ordax-owner-development-recovery.conf',
    ),
}
for target_path, (canonical_source, mode_token, output_name) in owner_entry_specs.items():
    artifacts = [artifact for artifact in uefi['artifacts'] if artifact['target_path'] == target_path]
    if len(artifacts) != 1:
        raise SystemExit(f'owner-development boot artifact is not unique: {target_path}')
    artifact = artifacts[0]
    if artifact['source_path'] != canonical_source:
        raise SystemExit(f'owner-development boot source differs from canonical manifest: {target_path}')
    source = pathlib.Path(canonical_source).read_text(encoding='utf-8')
    expected = f'options console=tty0 {mode_token}\n'
    if source.count(expected) != 1:
        raise SystemExit(f'owner-development boot options are not canonical: {target_path}')
    owner_source = source.replace(
        expected,
        expected.rstrip('\n') + f' {owner_profile_token}\n',
    )
    owner_path = owner_entry_dir / output_name
    owner_path.write_text(owner_source, encoding='utf-8')
    artifact['source_path'] = owner_path.as_posix()
    artifact['sha256'] = digest(owner_path)
    artifact['reason'] = (
        artifact['reason']
        + '; Owner/Development distribution profile is explicit before writable root discovery'
    )
kernel_version = os.environ.get('ORDAX_KERNEL_VERSION') or json.loads(pathlib.Path('bootstrap/kernel/source.json').read_text(encoding='utf-8'))['version']
kernel_artifacts = groups['kernel']['artifacts']
if len(kernel_artifacts) != 1:
    raise SystemExit('owner-development kernel artifact inventory must contain one artifact')
kernel_artifact = kernel_artifacts[0]
expected_source = f'bootstrap/kernel/vmlinuz-{kernel_version}'
if kernel_artifact['source_path'] != expected_source:
    raise SystemExit('owner-development kernel source differs from canonical manifest')
kernel_artifact['sha256'] = digest(f'out/kernel/vmlinuz-{kernel_version}')
groups['initramfs']['artifacts'][0]['sha256'] = digest('out/initramfs/initramfs.cpio.gz')
orchestrator = groups['bootstrap-orchestrator']
orchestrator['source_owner'] = 'bootstrap/dev'
orchestrator['artifacts'] = [{
    'source_path': 'bootstrap/dev/entrypoint',
    'target_path': '/ordax/bootstrap/entrypoint',
    'sha256': digest('bootstrap/dev/entrypoint'),
    'mode': '0755',
    'logical_owner': 'bootstrap-dev-orchestrator',
    'reason': 'Development-only handoff into the preseeded network and Git base'
}]
manifest['status'] = 'owner-dev-git-bootstrap'
manifest['policy'] = 'minimum-release-acquisition-first'
manifest['all_artifacts_resolved'] = True
manifest['physical_write_allowed'] = False
manifest['required_capabilities_before_first_release'] = [
    'uefi-boot', 'kernel', 'initramfs', 'development-network', 'git-client'
]
manifest['optional_after_first_release'] = []
manifest['boot_policy'] = {
    'development_mode': True,
    'distribution_profile': owner_profile_id,
    'network_before_git': True,
    'git_repository': 'https://github.com/ordaxsystems/ordax-os.git',
    'branch': 'main',
    'source_checkout_path': '/workspace/ordax',
    'ordinary_change_requires_usb_reflash': False
}
manifest['runtime_roots_created_empty'] = []
manifest['current_pointer_initial_state'] = 'unset'
output.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

