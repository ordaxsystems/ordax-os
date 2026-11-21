/**
 * Only the fields consumed by Native Settings/System presentation invalidate
 * their visible DOM. Validate snapshots with the OS contract before calling.
 */
export function sameHostPresentationSnapshot(previous, next) {
  return previous?.connectivity === next?.connectivity
    && Array.isArray(previous?.capabilityIds)
    && Array.isArray(next?.capabilityIds)
    && previous.capabilityIds.length === next.capabilityIds.length
    && previous.capabilityIds.every((id, index) => id === next.capabilityIds[index]);
}
